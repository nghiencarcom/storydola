"""Automated Google OAuth login for account profile setup.

Usage: python add_account.py <account_name> "email----password----totp_secret"
"""
import asyncio
import base64
import hashlib
import hmac
import math
import re
import struct
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from patchright.async_api import async_playwright

from browser import (
    DOLA_GOOGLE_LOGIN_SELECTORS,
    LAUNCH_ARGS,
    _page_has_google_login_button,
    _page_has_login_button,
    _page_has_logged_out_marker,
    extension_launch_args,
    has_dola_session,
    login_browser_channel,
)
import config
from profile_identity import (
    extract_email_addresses,
    google_emails_match,
    save_google_profile_identity,
)


DOLA_HOME_URL = "https://www.dola.com/"
DOLA_CHAT_URL = "https://www.dola.com/chat"


def _is_transient_google_navigation_error(error: Exception) -> bool:
    """Return whether Google destroyed a document while moving to its next step."""
    message = str(error or "").casefold()
    return (
        "execution context was destroyed" in message
        or "most likely because of a navigation" in message
        or "frame was detached" in message
    )


def _optional_browser_context_options() -> dict:
    """Return locale overrides only when the operator explicitly sets them."""
    options = {}
    if config.BROWSER_LOCALE:
        options["locale"] = config.BROWSER_LOCALE
    if config.BROWSER_TIMEZONE:
        options["timezone_id"] = config.BROWSER_TIMEZONE
    return options


async def _has_active_dola_session(context, page=None) -> bool:
    """Require a Dola cookie and one Dola tab that is not showing login.

    OAuth may reuse the original Dola tab or create a second callback tab. The
    old implementation trusted only ``page`` and could inspect a stale login
    document even though another tab in the same persistent context had the
    authenticated session.
    """
    cookies = await context.cookies("https://www.dola.com")
    if not has_dola_session(cookies):
        return False

    candidates = []
    seen = set()
    try:
        raw_pages = ([page] if page is not None else []) + list(reversed(context.pages))
        for candidate in raw_pages:
            marker = id(candidate)
            if marker in seen:
                continue
            seen.add(marker)
            if candidate.is_closed():
                continue
            url = str(candidate.url or "")
            if "dola.com" in url and "accounts.google.com" not in url:
                candidates.append(candidate)
    except Exception:
        return False

    for candidate in candidates:
        if "from_logout" in str(candidate.url or ""):
            continue
        if not await _page_has_logged_out_marker(candidate):
            return True
    return False


async def _wait_for_stable_dola_session(
    context,
    page,
    timeout_ms: int | None = None,
    allow_cookie_only: bool = False,
) -> bool:
    """Require two consecutive persisted-session reads after OAuth.

    The callback can briefly expose the old Dola document while the new
    session cookie is being committed.  A second read after the page settles
    prevents a relogin flow from reporting success just before Dola redirects
    the profile back to its login state.
    """
    settle_timeout_ms = (
        config.LOGIN_SESSION_VERIFY_TIMEOUT_SEC * 1000
        if timeout_ms is None
        else timeout_ms
    )
    deadline = time.monotonic() + max(1000, int(settle_timeout_ms)) / 1000
    consecutive = 0
    while time.monotonic() < deadline:
        authenticated = await _has_active_dola_session(context, page)
        if not authenticated and allow_cookie_only:
            # A stale/animated Dola Login label can briefly remain visible
            # while the authenticated chat shell is already mounted. The
            # The fresh page/session check is authoritative, so let the flow
            # continue when the new persistent cookie has settled.
            try:
                authenticated = has_dola_session(
                    await context.cookies("https://www.dola.com")
                )
            except Exception:
                authenticated = False
        if authenticated:
            consecutive += 1
            if consecutive >= 2:
                return True
        else:
            consecutive = 0
        # Do not sleep on the page object here. OAuth can close or replace the
        # original tab while the persistent context is still alive; an
        # asyncio sleep lets the next pass inspect whichever Dola tab remains.
        await asyncio.sleep(0.4)
    return False


async def click_first_visible(page, selectors: list[str], timeout: int = 12000) -> str:
    """Click the first visible selector, allowing Dola's locale/UI to vary."""
    deadline = time.monotonic() + timeout / 1000
    for selector in selectors:
        remaining = max(1000, int((deadline - time.monotonic()) * 1000))
        if remaining <= 0:
            break
        try:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(count):
                candidate = locator.nth(index)
                if not await candidate.is_visible():
                    continue
                await candidate.click(timeout=remaining)
                return selector
        except Exception:
            continue
    return ""


DOLA_LOGIN_SELECTORS = [
    "button:has-text('Log In')",
    "button:has-text('Đăng nhập')",
    "button:has-text('ログイン')",
    "button:has-text('登录')",
    "button:has-text('Sign in')",
    "[role='button']:has-text('Log In')",
    "[role='button']:has-text('Đăng nhập')",
    "[role='button']:has-text('ログイン')",
    "[role='button']:has-text('登录')",
    "[role='button']:has-text('Sign in')",
    "text=Log In",
    "text=Đăng nhập",
    "text=ログイン",
]

DOLA_GOOGLE_SELECTORS = [
    *DOLA_GOOGLE_LOGIN_SELECTORS,
]


async def _click_google_login_with_retry(page, timeout: int = 15000) -> str:
    """Click a Google/Gmail provider button that may mount after the modal.

    Dola sometimes paints the login sheet after the header click. A single
    selector scan can therefore finish before the provider button exists even
    though the login flow is healthy. Poll the visible Google/Gmail controls
    for the configured window instead of reopening the header modal.
    """
    deadline = time.monotonic() + max(1, timeout) / 1000
    while time.monotonic() < deadline:
        remaining = max(1, int((deadline - time.monotonic()) * 1000))
        selector = await click_first_visible(
            page,
            DOLA_GOOGLE_SELECTORS,
            timeout=min(1000, remaining),
        )
        if selector:
            return selector
        await page.wait_for_timeout(min(250, remaining))
    return ""


async def _click_dola_login_then_google(
    page, *, login_timeout: int = 15000, google_timeout: int = 15000
) -> tuple[str, str]:
    """Open Dola's Google OAuth flow in the required order.

    A profile can land in either state: only the header ``Log In`` button is
    visible, or the login sheet already exposes a Google/Gmail button. Prefer
    the already-visible provider button; otherwise click ``Log In`` once and
    wait for the provider button to mount.
    """
    login_selector = ""
    # Two valid entry states exist after dola.com loads: the header Login
    # button, or a login sheet that already exposes Google/Gmail. If the
    # provider button is visible, click it directly; clicking the header again
    # can toggle/close an already-open sheet.
    google_button_visible = await _page_has_google_login_button(page)
    if not google_button_visible and await _page_has_login_button(page):
        login_selector = await click_first_visible(
            page, DOLA_LOGIN_SELECTORS, timeout=login_timeout
        )
        if not login_selector:
            raise RuntimeError("Không tìm thấy nút đăng nhập Dola sau khi đã phát hiện Log In")
        await page.wait_for_timeout(1200)

    google_selector = await _click_google_login_with_retry(page, google_timeout)
    if not google_selector:
        # Some Dola builds mount the login modal only after the first header
        # click. This fallback is still ordered: click Log In, wait, then
        # search for the Google option.
        if not login_selector:
            login_selector = await click_first_visible(
                page, DOLA_LOGIN_SELECTORS, timeout=login_timeout
            )
            if not login_selector:
                raise RuntimeError("Không tìm thấy nút đăng nhập Dola")
            await page.wait_for_timeout(1200)
        google_selector = await _click_google_login_with_retry(page, google_timeout)
    if not google_selector:
        raise RuntimeError("Không tìm thấy nút đăng nhập bằng Google/Gmail của Dola")
    return login_selector, google_selector


async def _find_google_page(context, fallback_page=None, timeout: int = 0):
    """Find the Google OAuth tab, whether Dola opened a popup or reused its tab."""
    deadline = time.monotonic() + max(0, timeout) / 1000
    while True:
        pages = list(context.pages)
        for candidate in reversed(pages):
            try:
                if not candidate.is_closed() and "accounts.google.com" in candidate.url:
                    return candidate
            except Exception:
                continue
        if fallback_page is not None:
            try:
                if not fallback_page.is_closed() and "accounts.google.com" in fallback_page.url:
                    return fallback_page
            except Exception:
                pass
        if time.monotonic() >= deadline:
            return None
        if fallback_page is not None:
            await fallback_page.wait_for_timeout(400)
        else:
            await asyncio.sleep(0.4)


async def _click_google_profile(page, email: str) -> bool:
    """Select an already signed-in Google account without entering its password."""
    address = str(email or "").strip()
    if not address:
        return False

    # The chooser has used data attributes, an exact text node, and an aria
    # label across different Google UI versions. Prefer exact text so an email
    # containing punctuation is not interpolated into a CSS selector.
    try:
        locator = page.get_by_text(address, exact=True).first
        if await locator.count() and await locator.is_visible():
            await locator.click(timeout=3000)
            return True
    except Exception:
        pass

    # Gmail addresses can be displayed with dots (for example
    # ``first.last@gmail.com``) even when the input/metadata uses
    # ``firstlast@gmail.com``. Match Google's account row by semantic data
    # attributes before trying the legacy text selector fallbacks.
    for selector in ("[data-identifier]", "[data-email]", "[aria-label]"):
        try:
            locator = page.locator(selector)
            for index in range(min(await locator.count(), 40)):
                candidate = locator.nth(index)
                if not await candidate.is_visible():
                    continue
                values = []
                for attribute in ("data-identifier", "data-email", "aria-label"):
                    try:
                        value = await candidate.get_attribute(attribute)
                    except Exception:
                        value = None
                    if value:
                        values.append(value)
                try:
                    values.append(await candidate.inner_text())
                except Exception:
                    pass
                if any(google_emails_match(value, address) for value in values):
                    await candidate.click(timeout=3000)
                    return True
        except Exception:
            continue

    for selector in (
        f"[data-identifier='{address}']",
        f"[data-email='{address}']",
        f"[aria-label*='{address}']",
        f"text={address}",
    ):
        try:
            locator = page.locator(selector).first
            if await locator.count() and await locator.is_visible():
                await locator.click(timeout=3000)
                return True
        except Exception:
            continue
    return False


async def _advance_google_session(page, email: str, account_selected: bool) -> bool:
    """Advance only the safe, password-free parts of an existing Google session."""
    if not page or page.is_closed() or "accounts.google.com" not in page.url:
        return account_selected

    address = str(email or "").strip()
    try:
        page_text = await page.locator("body").inner_text(timeout=3000)
    except Exception:
        page_text = ""
    normalized_text = " ".join(str(page_text or "").split()).casefold()
    normalized_address = address.casefold()
    visible_emails = extract_email_addresses(page_text)
    target_visible = any(
        google_emails_match(address, value) for value in visible_emails
    )
    if address and (target_visible or normalized_address in normalized_text):
        if not account_selected and await _click_google_profile(page, email):
            print("[google] Existing profile -> selected saved Google account", flush=True)
        # Consent pages may show the current address as plain text rather than
        # an account-chooser row; in either case it is safe to continue.
        account_selected = True
    elif address and visible_emails and not target_visible:
        # Never click OAuth consent for a different Google account. Ask the
        # chooser for the saved address when Google exposes that option; if it
        # does not, leave the headed window for manual correction and keep
        # waiting instead of silently switching identities.
        other_account = await _first_visible(page, [
            "text=Use another account",
            "text=Sử dụng tài khoản khác",
            "text=Dùng tài khoản khác",
            "text=別のアカウントを使用",
            "text=使用其他账号",
        ])
        if other_account is not None:
            try:
                await other_account.click()
                print(
                    f"[google] OAuth đang chọn tài khoản khác; chuyển về {address}",
                    flush=True,
                )
            except Exception:
                pass
        else:
            print(
                f"[google] OAuth đang hiển thị tài khoản khác; chưa chấp nhận consent "
                f"cho profile {address}",
                flush=True,
            )
        return account_selected

    if not account_selected and await _click_google_profile(page, email):
        print("[google] Existing profile -> selected saved Google account", flush=True)
        account_selected = True

    # OAuth consent can still be shown even when Google has an active session.
    # Clicking these buttons is safe; password, CAPTCHA, and 2FA remain
    # available for the operator in the headed profile window.
    consent = await click_first_visible(page, [
        "#submit_button",
        "#submit_approve_access",
        "[role='button']:has-text('Tiếp tục')",
        "button:has-text('Tiếp tục')",
        "[role='button']:has-text('Cho phép')",
        "button:has-text('Cho phép')",
        "[role='button']:has-text('Continue')",
        "button:has-text('Continue')",
        "[role='button']:has-text('Allow')",
        "button:has-text('Allow')",
    ], timeout=1200)
    if consent:
        print(f"[google] Existing profile -> continued OAuth ({consent})", flush=True)
    return account_selected


def totp(secret: str, period: int = 30, digits: int = 6) -> str:
    """Standard TOTP (RFC 6238), Google Authenticator compatible."""
    raw = str(secret or "").strip()
    # Accept both the raw Base32 value copied from an authenticator and an
    # otpauth:// URI.  The secret stays on this machine; no external OTP site
    # is needed (or contacted).
    if raw.lower().startswith("otpauth://"):
        values = parse_qs(urlparse(raw).query).get("secret", [])
        raw = values[0] if values else ""
    normalized = re.sub(r"[\s-]+", "", raw.upper()).rstrip("=")
    if not normalized:
        raise ValueError("TOTP secret trống hoặc không hợp lệ (cần chuỗi Base32 hoặc otpauth URI)")
    if not re.fullmatch(r"[A-Z2-7]+", normalized):
        raise ValueError("TOTP secret không phải Base32 hợp lệ")
    try:
        key = base64.b32decode(normalized + "=" * ((8 - len(normalized) % 8) % 8), casefold=True)
    except Exception as exc:
        raise ValueError("TOTP secret không phải Base32 hợp lệ") from exc
    counter = int(time.time() // period)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[19] & 15
    code = (struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % (10 ** digits)
    return str(code).zfill(digits)


async def _force_google_locale(page) -> None:
    """Set Google's page language without changing the OAuth state."""
    locale = str(getattr(config, "GOOGLE_LOCALE", "vi") or "").strip()
    if not locale or "accounts.google.com" not in page.url:
        return
    try:
        parsed = urlparse(page.url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        query["hl"] = [locale]
        localized = urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
        if localized != page.url:
            await page.goto(localized, timeout=60000, wait_until="domcontentloaded")
            await page.wait_for_timeout(1000)
    except Exception as exc:
        # Language is cosmetic; never fail an otherwise valid OAuth flow for it.
        print(f"[google] Could not set page language: {str(exc)[:120]}", flush=True)


async def _first_visible(page, selectors: list[str]):
    """Return the first visible locator from a list of locale-aware selectors."""
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.count() and await locator.is_visible():
                return locator
        except Exception:
            continue
    return None


async def google_login(g, email: str, password: str, secret: str,
                       context=None, dola_page=None):
    """Executes Google OAuth login state machine until callback."""
    await _force_google_locale(g)
    manual_challenge_reported = False
    poll_steps = max(1, math.ceil(config.LOGIN_FLOW_TIMEOUT_SEC / 2.5))
    for step in range(poll_steps):
        try:
            await g.wait_for_timeout(2500)
        except Exception as exc:
            if _is_transient_google_navigation_error(exc):
                await asyncio.sleep(0.4)
                continue
            if "target page" in str(exc).casefold() and "closed" in str(exc).casefold():
                # A popup can close immediately after handing the OAuth
                # callback back to Dola. Let the Dola session verifier decide
                # whether the callback actually succeeded.
                print("[google] OAuth tab closed; checking Dola callback", flush=True)
                return
            raise
        # Google can finish OAuth and leave its tab open while Dola has
        # already committed the callback in another tab. The persistent Dola
        # session is the stronger signal, so do not wait for Google to
        # navigate away before continuing with verification.
        if context is not None and dola_page is not None:
            try:
                if await _has_active_dola_session(context, dola_page):
                    print(
                        "[google] Dola callback session detected; continuing with session verification",
                        flush=True,
                    )
                    return
            except Exception as exc:
                if not _is_transient_google_navigation_error(exc):
                    print(
                        f"[google] Dola callback check deferred: {str(exc)[:160]}",
                        flush=True,
                    )
        if "accounts.google.com" not in g.url:
            print("[google] Redirected out of Google domain (OAuth callback)", flush=True)
            return
        try:
            page_text = await g.evaluate("() => (document.body && document.body.innerText || '').slice(0, 1200)")
        except Exception as exc:
            if _is_transient_google_navigation_error(exc):
                print("[google] OAuth page is navigating; rechecking the next step", flush=True)
                await asyncio.sleep(0.4)
                continue
            raise
        if (
            "challenge/recaptcha" in g.url
            or "reCAPTCHA" in page_text
            or "not a robot" in page_text.lower()
            or "ロボットによる操作でない" in page_text
        ):
            if not manual_challenge_reported:
                print("[google] CAPTCHA/identity check detected; complete it in the account window", flush=True)
                manual_challenge_reported = True
            continue
        # 1) Account chooser page
        if "accountchooser" in g.url:
            if await _click_google_profile(g, email):
                print("[google] Account chooser page -> clicked account", flush=True)
                continue
        # 2) Email page
        identifier = g.locator("#identifierId").first
        if await identifier.count() and await identifier.is_visible():
            await identifier.fill(email)
            # Use DOM click to safely trigger submit event
            try:
                await g.locator("#identifierNext").evaluate("e => e.click()")
            except Exception as exc:
                if _is_transient_google_navigation_error(exc):
                    await asyncio.sleep(0.4)
                    continue
                raise
            print("[google] Email page -> submit", flush=True)
            await g.wait_for_timeout(1500)
            continue
        # 3) Password page
        pwd = g.locator('input[name="Passwd"]').first
        if await pwd.count() and await pwd.is_visible():
            await g.wait_for_timeout(600)
            await pwd.fill(password)
            try:
                await g.locator("#passwordNext").evaluate("e => e.click()")
            except Exception as exc:
                if _is_transient_google_navigation_error(exc):
                    await asyncio.sleep(0.4)
                    continue
                raise
            print("[google] Password page -> submit", flush=True)
            await g.wait_for_timeout(1500)
            continue
        # 4) Consent page
        clicked = False
        for sel in ["#submit_button",
                    "[role='button']:has-text('続行')", "button:has-text('続行')",
                    "[role='button']:has-text('继续')", "button:has-text('继续')",
                    "[role='button']:has-text('Tiếp tục')", "button:has-text('Tiếp tục')",
                    "[role='button']:has-text('Cho phép')", "button:has-text('Cho phép')",
                    "[role='button']:has-text('Continue')", "button:has-text('Continue')"]:
            try:
                loc = g.locator(sel).first
                if await loc.count() and await loc.is_visible():
                    await loc.click(timeout=3000)
                    print(f"[google] Consent page -> clicked {sel}", flush=True)
                    clicked = True
                    break
            except Exception:
                continue
        if clicked:
            continue
        # 5) Authenticator choice / 2FA page.  Google uses several different
        # labels and input attributes across locales and account states.
        otp_input = await _first_visible(g, [
            "#totpPin",
            "input[name='totpPin']",
            "input[autocomplete='one-time-code']",
            "input[type='tel']",
        ])
        if otp_input is not None:
            if not secret:
                raise RuntimeError("Google requested 2FA, but no TOTP secret was provided")
            code = totp(secret)
            await otp_input.fill(code)
            # Google currently renders #totpNext as a clickable DIV rather
            # than a native button. Playwright's actionability wait can hang
            # on that wrapper even though its click handler is ready. Use the
            # same DOM click strategy as the email/password steps, then fall
            # back to a short native click or Enter for older Google shells.
            await g.wait_for_timeout(700)
            next_button = await _first_visible(g, [
                "#totpNext",
                "button:has-text('Tiếp theo')",
                "button:has-text('Next')",
                "button:has-text('次へ')",
                "[role='button']:has-text('Tiếp theo')",
                "[role='button']:has-text('Next')",
            ])
            submitted = False
            if next_button is not None:
                try:
                    await next_button.evaluate("element => element.click()")
                    submitted = True
                except Exception:
                    try:
                        await next_button.click(timeout=5000)
                        submitted = True
                    except Exception:
                        pass
            if not submitted:
                # Do not use Locator.press here. Google sometimes replaces
                # the OTP input during submission, leaving Playwright waiting
                # for the stale locator for its full 30-second default.
                try:
                    await g.keyboard.press("Enter")
                    submitted = True
                except Exception as exc:
                    raise RuntimeError(
                        "Google không nhận được mã xác thực TOTP; hãy bấm Tiếp theo trên profile"
                    ) from exc
            print("[google] 2FA page -> generated and submitted local TOTP", flush=True)
            await g.wait_for_timeout(1200)
            continue

        # Some accounts show a chooser before displaying the authenticator
        # input.  Select the authenticator method when it is offered.
        authenticator = await _first_visible(g, [
            "text=Use your Google Authenticator app",
            "text=Google Authenticator",
            "text=Sử dụng ứng dụng Google Authenticator",
            "text=Ứng dụng Google Authenticator",
            "text=認証システム アプリ",
            "text=Google 認証システム アプリ",
            "text=使用 Google 身份验证器应用",
        ])
        if authenticator is not None:
            try:
                await authenticator.click()
                await g.wait_for_timeout(1000)
                continue
            except Exception:
                pass

        try_another_way = await _first_visible(g, [
            "text=Try another way",
            "text=Thử cách khác",
            "text=別の方法を試す",
            "text=尝试其他方式",
        ])
        if try_another_way is not None:
            try:
                await try_another_way.click()
                await g.wait_for_timeout(1000)
                continue
            except Exception:
                pass
        # 6) Dola 18+ age confirmation popup
        if await g.locator("text=18").count():
            ok = await g.evaluate("""() => {
                const els = [...document.querySelectorAll('button, [role="button"], div, span')];
                const t = els.find(e => (e.textContent || '').trim() === 'OK' && e.childElementCount === 0);
                if (t) { t.click(); return true; }
                return false;
            }""")
            print(f"[dola] Age confirmation -> JS click OK = {ok}", flush=True)
            await g.wait_for_timeout(1500)
            continue
        print(f"[google] step{step} unrecognized page url={g.url[:80]} text={page_text[:200]}", flush=True)
    if "accounts.google.com" in g.url:
        await g.screenshot(path="dbg_google2.png")
        if manual_challenge_reported:
            raise RuntimeError(
                "Google CAPTCHA/identity verification was not completed within "
                f"{math.ceil(config.LOGIN_FLOW_TIMEOUT_SEC / 60)} minutes "
                "(saved dbg_google2.png)"
            )
        raise RuntimeError(
            "Google login did not complete within "
            f"{math.ceil(config.LOGIN_FLOW_TIMEOUT_SEC / 60)} minutes "
            "(saved dbg_google2.png)"
        )


async def add_account_flow(account: str, email: str, password: str, secret: str,
                           profile_dir: str | Path | None = None,
                           proxy: dict | str | None = None) -> bool:
    """Full account addition flow; returns True on success."""
    profile_dir = Path(profile_dir) if profile_dir is not None else Path("accounts") / account
    profile_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        # Login is headed as well, so load the same unpacked Dola extension
        # used by rendering. This keeps the account profile ready for a
        # subsequent render and makes the extension visible in the login
        # Chromium window instead of only loading it later in the worker.
        args = list(LAUNCH_ARGS)
        args.extend(extension_launch_args())
        kwargs = {
            "headless": False,
            "args": args,
            "ignore_default_args": ["--disable-extensions"],
            **_optional_browser_context_options(),
        }
        browser_channel = login_browser_channel()
        if browser_channel:
            kwargs["channel"] = browser_channel
        selected_proxy = proxy or config.PROXY
        if selected_proxy:
            kwargs["proxy"] = (
                {"server": selected_proxy}
                if isinstance(selected_proxy, str)
                else {
                    key: value for key, value in selected_proxy.items()
                    if key in {"server", "username", "password"} and value
                }
            )
        context = await p.chromium.launch_persistent_context(str(profile_dir), **kwargs)
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto("https://www.dola.com/chat", timeout=60000, wait_until="domcontentloaded")
            await page.wait_for_timeout(4000)

            if await _has_active_dola_session(context, page):
                print(f"[{account}] Active session exists, login not required", flush=True)
                return True

            # Always inspect/click the visible Dola Login entry before looking
            # for Google. This prevents an old/hidden modal from skipping the
            # current profile's authentication step.
            try:
                _, google_selector = await _click_dola_login_then_google(
                    page, login_timeout=15000, google_timeout=15000
                )
            except RuntimeError:
                await page.screenshot(path="dbg_add_account.png")
                raise
            print(f"[dola] Login -> Google ({google_selector})", flush=True)

            # Google page may open in popup or active tab
            await page.wait_for_timeout(3000)
            g = next((pg for pg in context.pages if "accounts.google.com" in pg.url), None)
            if g is None and "accounts.google.com" in page.url:
                g = page
            if g is None:
                await page.screenshot(path="dbg_add_account.png")
                raise RuntimeError("Failed to redirect to Google login page (saved dbg_add_account.png)")

            await google_login(
                g,
                email,
                password,
                secret,
                context=context,
                dola_page=page,
            )

            # Wait for a Dola session cookie after the OAuth callback. Two
            # consecutive authenticated reads are required so a transient
            # callback document cannot be reported as success just before
            # Dola redirects the profile back to its login state.
            deadline = time.monotonic() + config.LOGIN_FLOW_TIMEOUT_SEC
            while time.monotonic() < deadline:
                if await _wait_for_stable_dola_session(
                    context,
                    page,
                    timeout_ms=config.LOGIN_SESSION_VERIFY_TIMEOUT_SEC * 1000,
                    allow_cookie_only=True,
                ):
                    try:
                        save_google_profile_identity(profile_dir, email)
                    except Exception as exc:
                        # Chromium's own Preferences/Cookies remain the source
                        # of the live session. The small identity manifest is
                        # diagnostic metadata, so a filesystem hiccup must not
                        # discard an otherwise valid Dola login.
                        print(
                            f"[{account}] Google identity marker was not written: "
                            f"{type(exc).__name__}: {str(exc)[:160]}",
                            flush=True,
                        )
                    print(f"[{account}] ✓ Login successful, Dola session saved to {profile_dir}", flush=True)
                    return True
                await asyncio.sleep(1.5)
            await page.screenshot(path="dbg_add_account.png")
            raise RuntimeError(
                "Dola session was not acquired within "
                f"{math.ceil(config.LOGIN_FLOW_TIMEOUT_SEC / 60)} minutes "
                "(saved dbg_add_account.png)"
            )
        finally:
            await context.close()


async def relogin_existing_account_flow(account: str, email: str = "",
                                        proxy: dict | str | None = None) -> bool:
    """Re-authenticates Dola inside an existing profile using its Google session.

    This deliberately does not replace the profile or ask for a password. A
    profile created by the normal login flow already contains the Google
    session, so selecting Dola's Google login can complete OAuth directly. If
    Google needs an account chooser, CAPTCHA, password, or 2FA, the headed
    window remains available for the operator to finish it manually.
    """
    profile_dir = Path("accounts") / account
    if not profile_dir.is_dir():
        raise FileNotFoundError(f"Account profile does not exist: {profile_dir}")

    async with async_playwright() as p:
        args = list(LAUNCH_ARGS)
        args.extend(extension_launch_args())
        kwargs = {
            "headless": False,
            "args": args,
            "ignore_default_args": ["--disable-extensions"],
            **_optional_browser_context_options(),
        }
        browser_channel = login_browser_channel()
        if browser_channel:
            kwargs["channel"] = browser_channel
        selected_proxy = proxy or config.PROXY
        if selected_proxy:
            kwargs["proxy"] = (
                {"server": selected_proxy}
                if isinstance(selected_proxy, str)
                else {
                    key: value for key, value in selected_proxy.items()
                    if key in {"server", "username", "password"} and value
                }
            )
        context = await p.chromium.launch_persistent_context(str(profile_dir), **kwargs)
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            # Start from the public Dola entry point in the same persistent
            # profile. This is important for profiles where Gmail is still
            # signed in but the Dola session cookie has expired.
            last_login_error = None
            for dola_url in (DOLA_HOME_URL, DOLA_CHAT_URL):
                await page.goto(dola_url, timeout=60000, wait_until="domcontentloaded")
                await page.wait_for_timeout(3000 if dola_url == DOLA_HOME_URL else 2200)
                if await _has_active_dola_session(context, page):
                    print(f"[{account}] Active Dola session exists, relogin not required", flush=True)
                    return True

                try:
                    # The helper checks the header Login button first and
                    # clicks it before selecting the Google provider.
                    _, google_selector = await _click_dola_login_then_google(
                        page,
                        login_timeout=12000,
                        google_timeout=3500 if dola_url == DOLA_HOME_URL else 7000,
                    )
                    if google_selector:
                        break
                except RuntimeError as error:
                    # Home and /chat can render different auth shells. Try
                    # the second entry point before reporting a real failure.
                    last_login_error = error
            else:
                google_selector = ""

            if not google_selector:
                await page.screenshot(path="dbg_relogin_existing.png")
                raise last_login_error or RuntimeError(
                    "Không tìm thấy nút đăng nhập trên dola.com trong profile Gmail "
                    "(saved dbg_relogin_existing.png)"
                )
            print(f"[{account}] dola.com relogin -> Google ({google_selector})", flush=True)

            # Dola can open OAuth in a popup or reuse the current tab. Wait for
            # either case instead of silently polling a non-Google page.
            google_page = await _find_google_page(context, page, timeout=15000)
            if google_page is None:
                await page.screenshot(path="dbg_relogin_existing.png")
                raise RuntimeError(
                    "Dola không mở được trang đăng nhập Google trong profile Gmail "
                    "(saved dbg_relogin_existing.png)"
                )

            deadline = time.monotonic() + config.LOGIN_FLOW_TIMEOUT_SEC
            account_selected = False
            oauth_return_checked = False
            while time.monotonic() < deadline:
                latest_google_page = await _find_google_page(context, page)
                oauth_in_flight = latest_google_page is not None
                if latest_google_page is not None:
                    google_page = latest_google_page
                    try:
                        account_selected = await _advance_google_session(
                            google_page, email, account_selected
                        )
                    except Exception as exc:
                        print(
                            f"[{account}] Google session step needs manual completion: "
                            f"{str(exc)[:180]}",
                            flush=True,
                        )
                    # Google may keep its OAuth tab open after the Dola
                    # callback has already authenticated another tab. Check
                    # the persistent context before waiting for the Google
                    # tab to disappear, otherwise the whole flow can expire
                    # even though the session is ready.
                    try:
                        if await _has_active_dola_session(context, page):
                            print(
                                f"[{account}] Dola callback session detected while Google tab remained open",
                                flush=True,
                            )
                            oauth_in_flight = False
                    except Exception as exc:
                        if not _is_transient_google_navigation_error(exc):
                            print(
                                f"[{account}] Dola callback check deferred: {str(exc)[:160]}",
                                flush=True,
                            )
                if not oauth_in_flight:
                    # Do not trust the old Dola tab while OAuth is still in
                    # flight. It can retain the old session cookie and the
                    # old chat DOM even though Dola has already logged the
                    # profile out. Once Google leaves its domain, reload the
                    # Dola entry point and verify the callback result on a
                    # fresh document before declaring the profile restored.
                    if not oauth_return_checked:
                        await page.goto(
                            DOLA_CHAT_URL,
                            timeout=60000,
                            wait_until="domcontentloaded",
                        )
                        await page.wait_for_timeout(2200)
                        oauth_return_checked = True
                    if await _wait_for_stable_dola_session(
                        context,
                        page,
                        timeout_ms=config.LOGIN_SESSION_VERIFY_TIMEOUT_SEC * 1000,
                        allow_cookie_only=True,
                    ):
                        try:
                            save_google_profile_identity(profile_dir, email)
                        except Exception as exc:
                            print(
                                f"[{account}] Google identity marker was not written: "
                                f"{type(exc).__name__}: {str(exc)[:160]}",
                                flush=True,
                            )
                        print(f"[{account}] ✓ Dola session restored in existing profile", flush=True)
                        return True
                await page.wait_for_timeout(1500)

            await page.screenshot(path="dbg_relogin_existing.png")
            raise RuntimeError(
                "Dola session chưa được khôi phục trong "
                f"{math.ceil(config.LOGIN_FLOW_TIMEOUT_SEC / 60)} phút; hãy hoàn tất Google/CAPTCHA "
                "trên profile Gmail (saved dbg_relogin_existing.png)"
            )
        finally:
            await context.close()


async def main():
    account = sys.argv[1]
    email, password, secret = sys.argv[2].split("----")
    await add_account_flow(account, email, password, secret)
    print(f"[{account}] Account added successfully!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"✗ {e}")
        sys.exit(1)
