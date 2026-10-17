"""Patchright persistent context launcher: Explicit proxy and anti-detection parameters."""
import asyncio
import json
import re
import time
from pathlib import Path

import config

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
]

# Dola can expose either the page-level Login button or an already-mounted
# Google/Gmail provider button after the login sheet opens. Keep the provider
# labels/selectors shared by session checks and the OAuth flow.
DOLA_GOOGLE_LOGIN_LABELS = (
    "Continue with Google",
    "Log in with Google",
    "Login with Google",
    "Sign in with Google",
    "Continue with Gmail",
    "Log in with Gmail",
    "Login with Gmail",
    "Sign in with Gmail",
    "Tiếp tục với Google",
    "Đăng nhập bằng Google",
    "Đăng nhập với Google",
    "Tiếp tục với Gmail",
    "Đăng nhập bằng Gmail",
    "Đăng nhập với Gmail",
    "Googleで続ける",
    "Googleでログイン",
    "Gmailで続ける",
    "Gmailでログイン",
    "使用 Google 继续",
    "使用 Google 登录",
    "使用 Gmail 继续",
    "使用 Gmail 登录",
)

DOLA_GOOGLE_LOGIN_SELECTORS = tuple(
    selector
    for label in DOLA_GOOGLE_LOGIN_LABELS
    for selector in (
        f"button:has-text('{label}')",
        f"[role='button']:has-text('{label}')",
        f"a:has-text('{label}')",
        f"[role='dialog'] button:has-text('{label}')",
        f"[role='dialog'] [role='button']:has-text('{label}')",
    )
)
# Some releases expose only the provider name as the accessible label. These
# remain scoped to actionable controls, never ordinary body text.
DOLA_GOOGLE_LOGIN_SELECTORS += (
    "button:has-text('Google')",
    "[role='button']:has-text('Google')",
    "a:has-text('Google')",
    "button:has-text('Gmail')",
    "[role='button']:has-text('Gmail')",
    "a:has-text('Gmail')",
)


def extension_launch_args() -> list[str]:
    """Returns the command-line flags for the unpacked Dola extension."""
    if not config.EXTENSION_ENABLED:
        return []
    extension_dir = Path(config.EXTENSION_DIR)
    if not extension_dir.is_absolute():
        extension_dir = Path(__file__).resolve().parent / extension_dir
    extension_dir = extension_dir.resolve()
    if not extension_dir.is_dir():
        raise FileNotFoundError(f"Dola extension directory does not exist: {extension_dir}")
    return [
        f"--disable-extensions-except={extension_dir}",
        f"--load-extension={extension_dir}",
    ]


def login_browser_channel() -> str | None:
    """Use Patchright's bundled Chromium for interactive login profiles.

    Omitting the branded browser channel keeps login, profile verification,
    and rendering on the same Chromium runtime and user-data format.
    """
    return None


async def launch_account_context(p, account: str, headless: bool = None,
                                 use_extension: bool | None = None,
                                 hide_window: bool = False,
                                 profile_dir: str | Path | None = None,
                                 proxy: dict | str | None = None,
                                 browser_channel: str | None = None):
    """Launches accounts/<account> profile, returns BrowserContext. Caller must close.

    p: async_playwright() instance
    headless: None = uses config.HEADLESS
    hide_window: minimize headed render windows to the Dock, not off-screen
    """
    profile_path = Path(profile_dir) if profile_dir is not None else Path("accounts") / account
    if not profile_path.exists():
        raise FileNotFoundError(
            f"Account profile does not exist: {profile_path} (run python add_account.py {account} first)"
        )
    launch_headless = config.HEADLESS if headless is None else headless
    if use_extension is None:
        use_extension = config.EXTENSION_ENABLED and not launch_headless
    args = list(LAUNCH_ARGS)
    if use_extension:
        if not config.EXTENSION_ENABLED:
            raise RuntimeError("Dola extension is disabled (DOLA_EXTENSION_ENABLED=0)")
        # Extensions used by the Gateway require a headed Chromium window.
        launch_headless = False
        args.extend(extension_launch_args())
    if hide_window and not launch_headless:
        # The Dola30 debugger extension still needs a headed Chromium process.
        # Keep its native window out of the user's way while preserving the
        # page, extension service worker, and Playwright automation context.
        args.extend([
            "--start-minimized",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ])
    kwargs = {
        "headless": launch_headless,
        "args": args,
    }
    if browser_channel:
        kwargs["channel"] = browser_channel
    if use_extension:
        kwargs["ignore_default_args"] = ["--disable-extensions"]
    # Do not infer a browser locale from the Dola API's JP service region. When
    # no browser override is configured, omitting these options lets Chromium,
    # the existing profile and the destination site choose automatically.
    if config.BROWSER_LOCALE:
        kwargs["locale"] = config.BROWSER_LOCALE
    if config.BROWSER_TIMEZONE:
        kwargs["timezone_id"] = config.BROWSER_TIMEZONE
    # A profile-level managed proxy overrides the global fallback.  The
    # manager returns Playwright's ``server/username/password`` shape; plain
    # strings remain accepted for scripts and backwards compatibility.
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
    context = await p.chromium.launch_persistent_context(str(profile_path), **kwargs)
    if use_extension:
        try:
            extension_dir = Path(config.EXTENSION_DIR)
            if not extension_dir.is_absolute():
                extension_dir = Path(__file__).resolve().parent / extension_dir
            expected = json.loads((extension_dir / "manifest.json").read_text(encoding="utf-8"))
            expected_name = str(expected.get("name") or "").strip()
            expected_version = str(expected.get("version") or "").strip()
            if not expected_name:
                raise RuntimeError("Dola extension manifest does not declare a name")

            deadline = time.monotonic() + 20
            seen_names = set()
            manifest = None
            while time.monotonic() < deadline:
                for worker in context.service_workers:
                    if not worker.url.startswith("chrome-extension://"):
                        continue
                    try:
                        candidate = await worker.evaluate("chrome.runtime.getManifest()")
                    except Exception:
                        continue
                    name = str(candidate.get("name") or "").strip()
                    if name:
                        seen_names.add(name)
                    if name == expected_name and str(candidate.get("version") or "").strip() == expected_version:
                        manifest = candidate
                        break
                if manifest:
                    break
                await asyncio.sleep(0.25)
            if manifest is None:
                observed = ", ".join(sorted(seen_names)) or "no extension service workers"
                raise RuntimeError(
                    f"Expected {expected_name} {expected_version}; detected {observed}"
                )
            print(f"[{account}] Extension runtime loaded: {manifest['name']} {manifest.get('version', '')}", flush=True)
        except Exception as error:
            await context.close()
            raise RuntimeError(f"Không nạp được extension trong Chromium: {error}") from error
    if hide_window and not launch_headless:
        # Chromium may ignore --start-minimized on macOS when it restores the
        # previous profile window state. Use the DevTools window API after the
        # native window is ready so this render-only context stays minimized;
        # this targets the specific context and does not hide a user's login
        # window in another profile.
        await _minimize_render_window(context)
    elif not launch_headless:
        await _restore_visible_window(context)
    return context


async def _restore_visible_window(context):
    """Undo minimized/off-screen bounds persisted by older render runs."""
    if not context.pages:
        return
    cdp = None
    try:
        page = context.pages[0]
        cdp = await context.new_cdp_session(page)
        target = await cdp.send("Browser.getWindowForTarget")
        window_id = target.get("windowId")
        if window_id is None:
            return
        await cdp.send("Browser.setWindowBounds", {
            "windowId": window_id, "bounds": {"windowState": "normal"},
        })
        await cdp.send("Browser.setWindowBounds", {
            "windowId": window_id,
            "bounds": {"left": 40, "top": 60, "width": 1280, "height": 800},
        })
        await page.bring_to_front()
    except Exception as error:
        print(f"  Could not restore visible browser window: {str(error)[:160]}", flush=True)
    finally:
        if cdp is not None:
            await cdp.detach()


async def _minimize_render_window(context):
    """Minimize one headed render context without affecting other profiles."""
    pages = context.pages
    if not pages:
        return
    cdp = None
    try:
        page = pages[0]
        # The native window can be created a moment after launch returns.
        await page.wait_for_timeout(200)
        cdp = await context.new_cdp_session(page)
        target = await cdp.send("Browser.getWindowForTarget")
        window_id = target.get("windowId") if isinstance(target, dict) else None
        if window_id is None:
            return
        # Clear off-screen bounds saved by older versions so restoring from
        # the Dock brings this window back onto the display.
        await cdp.send("Browser.setWindowBounds", {
            "windowId": window_id, "bounds": {"windowState": "normal"},
        })
        await cdp.send("Browser.setWindowBounds", {
            "windowId": window_id,
            "bounds": {"left": 40, "top": 60, "width": 1280, "height": 800},
        })
        # A second pass covers macOS restoring the profile's last normal
        # state just after the first window-state change.
        for delay in (0, 250, 500):
            if delay:
                await page.wait_for_timeout(delay)
            await cdp.send("Browser.setWindowBounds", {
                "windowId": window_id,
                "bounds": {"windowState": "minimized"},
            })
    except Exception as error:
        # Hiding is a convenience; a DevTools version without window control
        # must not make an otherwise valid video render fail.
        print(f"  Could not minimize render window: {str(error)[:160]}", flush=True)
    finally:
        if cdp is not None:
            try:
                await cdp.detach()
            except Exception:
                pass


def cookie_value(cookies: list, name: str) -> str:
    """Extracts cookie value from context.cookies() result."""
    return next((c["value"] for c in cookies if c["name"] == name and c["value"]), "")


def has_dola_session(cookies: list) -> bool:
    """Returns whether a persisted Dola browser session cookie is present.

    Dola/ByteDance has used both the regular and ``_ss`` session cookie in
    different login responses.  The browser sends both when available, so a
    verification check must not reject a valid profile just because one of
    the two names is missing.
    """
    return bool(cookie_value(cookies, "sessionid") or cookie_value(cookies, "sessionid_ss"))


async def _page_has_logged_out_marker(page) -> bool:
    """Detect a visible Dola login UI without matching ordinary page text.

    Authenticated Dola pages can contain translated login-related words in
    navigation or cached content.  Treating any occurrence in ``body.innerText``
    as logout caused a valid profile to be rotated away immediately before
    video submission.  Prefer the explicit header login control and OAuth
    dialog, then use only unambiguous Google-login phrases as a fallback.
    """
    if await _page_has_login_button(page) or await _page_has_google_login_button(page):
        return True

    # The label lives in a nested SPAN on current Dola. CSS :text-is on the
    # BUTTON misses it; accessible-name matching includes descendant text.
    for label in ("Log In", "Log in", "Đăng nhập"):
        try:
            buttons = page.get_by_role("button", name=label, exact=True)
            for index in range(await buttons.count()):
                if await buttons.nth(index).is_visible():
                    return True
        except Exception:
            pass
    # Guest pages keep chat controls and stale cookies. An exact, visible
    # login button is an authentication signal, unlike words in chat history.
    visible_login_selectors = (
        'button:text-is("Log In")',
        '[role="button"]:text-is("Log In")',
        'a:text-is("Log In")',
        'button:text-is("Log in")',
        'button:text-is("Đăng nhập")',
        ".login-btn-head",
        "button.login-btn-head",
        "a.login-btn-head",
        "[role='dialog'] button:has-text('Google')",
        "[role='dialog'] button:has-text('Continue with Google')",
        "[role='dialog'] button:has-text('Tiếp tục với Google')",
        "[role='dialog'] button:has-text('Googleで続ける')",
        "[role='dialog'] button:has-text('使用 Google 继续')",
    )
    for selector in visible_login_selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(min(count, 5)):
                if await locator.nth(index).is_visible():
                    return True
        except Exception:
            continue

    try:
        body_text = await page.locator("body").inner_text(timeout=5000)
    except Exception:
        body_text = ""
    # These phrases identify the OAuth login dialog rather than generic
    # navigation labels. Compare case-insensitively across Dola locales.
    normalized = " ".join(str(body_text or "").split()).casefold()
    return any(marker.casefold() in normalized for marker in (
        "continue with google",
        "log in with google",
        "login with google",
        "sign in with google",
        "tiếp tục với google",
        "đăng nhập bằng google",
        "đăng nhập với google",
        "googleで続ける",
        "使用 google 继续",
        "continue with gmail",
        "log in with gmail",
        "login with gmail",
        "sign in with gmail",
        "tiếp tục với gmail",
        "đăng nhập bằng gmail",
        "đăng nhập với gmail",
        "gmailで続ける",
        "使用 gmail 继续",
    ))


async def _page_has_login_button(page) -> bool:
    """Return whether Dola shows a visible header Login button.

    Current Dola renders ``Log In`` inside a ``span`` nested in ``button``.
    ``:text-is`` only matches the span, so use the button's descendant text
    and an accessible-name fallback. Ordinary words in chat history are not
    treated as a login control.
    """
    labels = ("Log In", "Log in", "Đăng nhập", "ログイン", "登录", "Sign in")
    for label in labels:
        try:
            buttons = page.get_by_role("button", name=label, exact=True)
            for index in range(await buttons.count()):
                if await buttons.nth(index).is_visible():
                    return True
        except Exception:
            continue

    for label in labels:
        for selector in (
            f'button:has-text("{label}")',
            f'[role="button"]:has-text("{label}")',
        ):
            try:
                locator = page.locator(selector)
                for index in range(min(await locator.count(), 5)):
                    candidate = locator.nth(index)
                    if not await candidate.is_visible():
                        continue
                    text = " ".join((await candidate.inner_text()).split()).casefold()
                    if text in {
                        label.casefold(),
                        f"{label.casefold()} ›",
                        f"{label.casefold()} >",
                    }:
                        return True
            except Exception:
                continue

    # Some profiles expose only the nested text node to Playwright. Walk to
    # its nearest semantic button as a final, scoped fallback.
    for label in labels:
        try:
            text_nodes = page.get_by_text(label, exact=True)
            for index in range(min(await text_nodes.count(), 5)):
                button = text_nodes.nth(index).locator("xpath=ancestor::button[1]")
                if await button.count() and await button.first.is_visible():
                    return True
        except Exception:
            continue
    return False


async def _page_has_google_login_button(page) -> bool:
    """Return whether Dola shows a visible Google/Gmail login control.

    Depending on how far the auth sheet has rendered, the control may be a
    native button, an element with ``role=button``, or a link. Only visible
    actionable elements are considered so a cached/hidden modal cannot make
    an authenticated profile look logged out.
    """
    for label in DOLA_GOOGLE_LOGIN_LABELS:
        try:
            buttons = page.get_by_role("button", name=label, exact=True)
            for index in range(min(await buttons.count(), 8)):
                if await buttons.nth(index).is_visible():
                    return True
        except Exception:
            continue

    for selector in DOLA_GOOGLE_LOGIN_SELECTORS:
        try:
            locator = page.locator(selector)
            for index in range(min(await locator.count(), 8)):
                if await locator.nth(index).is_visible():
                    return True
        except Exception:
            continue
    return False


async def check_login_state_details(account: str, profile_dir: str | Path | None = None,
                                    proxy: dict | str | None = None,
                                    timeout_sec: float | None = None) -> dict:
    """Checks a profile and distinguishes logout from temporary risk control.

    Dola can show its login wall while retaining the ``sessionid`` cookie when
    anti-abuse controls are active. Treating that page as a permanently expired
    profile makes the account pool disable a session that can recover later.
    Keep the richer result private to the Gateway; callers that only need the
    strict authenticated state should continue using :func:`check_login_state`.
    """
    from patchright.async_api import async_playwright
    async with async_playwright() as p:
        context = await launch_account_context(
            p, account, profile_dir=profile_dir, proxy=proxy
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            last_state = {
                "ok": False,
                "risk_control": False,
                "session_cookie": False,
                "login_ui": False,
                "url": "",
            }
            verify_timeout = max(
                10.0,
                float(
                    timeout_sec
                    if timeout_sec is not None
                    else config.LOGIN_SESSION_VERIFY_TIMEOUT_SEC
                ),
            )
            deadline = time.monotonic() + verify_timeout
            attempt = 0
            while True:
                attempt += 1
                try:
                    if attempt == 1:
                        await page.goto(
                            "https://www.dola.com/chat",
                            timeout=60000,
                            wait_until="domcontentloaded",
                        )
                    else:
                        # OAuth/session cookies can be committed shortly after
                        # the first document load. A reload avoids a transient
                        # false "expired" result without opening another window.
                        await page.reload(timeout=60000, wait_until="domcontentloaded")
                    await page.wait_for_timeout(4500 if attempt == 1 else 2500)
                    cookies = await context.cookies("https://www.dola.com")
                    session_cookie = has_dola_session(cookies)
                    login_ui = await _page_has_logged_out_marker(page)
                    url = str(page.url or "")
                    last_state = {
                        "ok": bool(session_cookie and not login_ui and "from_logout" not in url),
                        # A login wall with the old Dola cookie still present is
                        # the same signal observed after a risk-controlled submit.
                        "risk_control": bool(
                            session_cookie
                            and (login_ui or "from_logout" in url)
                        ),
                        "session_cookie": session_cookie,
                        "login_ui": login_ui,
                        "url": url,
                    }
                    if last_state["ok"] or last_state["risk_control"]:
                        return last_state
                except Exception as exc:
                    last_state["error"] = f"{type(exc).__name__}: {str(exc)[:240]}"
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return last_state
                # Keep the profile alive long enough for a delayed cookie
                # commit, but do not hammer Dola while its login shell loads.
                await asyncio.sleep(min(2.0, remaining))
        finally:
            await context.close()


async def check_login_state(account: str, profile_dir: str | Path | None = None,
                            proxy: dict | str | None = None) -> bool:
    """Opens Dola in headless mode and checks whether session is active.

    The old check required ``sessionid`` plus a particular editor selector.
    That produced false negatives when Dola returned ``sessionid_ss`` or
    rendered the editor after a longer delay. Cookies are now the primary
    signal and an explicit sign-in marker is used as the negative signal.
    """
    result = await check_login_state_details(
        account, profile_dir=profile_dir, proxy=proxy
    )
    return bool(result.get("ok"))


DOLA_LOGIN_PROBE_PROMPT = "Bạn có thể trả lời ngắn gọn bằng một từ: OK không?"
_CHAT_PROBE_EDITOR_SELECTORS = (
    '[data-testid="chat-input"]',
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]',
)
_CHAT_PROBE_SEND_SELECTORS = (
    "#flow-end-msg-send",
    'button[id*="msg-send"]',
    'button[aria-disabled="false"][id*="send"]',
    'button[data-testid*="send" i]',
    '[role="button"][data-testid*="send" i]',
    'button[data-e2e*="send" i]',
    ".send-btn-wrapper button",
    'button[type="submit"]',
    'button[aria-label*="gửi" i]',
    'button[aria-label*="send" i]',
    'button[aria-label*="送信"]',
    'button[aria-label*="发送"]',
    'button[title*="send" i]',
    '[class*="send-msg-btn"]',
)
_CHAT_PROBE_FAILURE_PATTERN = re.compile(
    r"please\s+(?:log|sign)\s+in|(?:log|sign)\s+in\s+to\s+(?:continue|chat)|"
    r"unauthori[sz]ed|not\s+authenticated|session\s+expired|"
    r"captcha|not\s+a\s+robot|risk\s+control|"
    r"i\s+can(?:not|'t|’t)\s+answer\s+(?:your|the)\s+question|"
    r"temporarily\s+unable|system\s+error|try\s+again\s+later|"
    r"không\s+thể\s+trả\s+lời|vui\s+lòng\s+đăng\s+nhập|"
    r"chưa\s+đăng\s+nhập|xác\s+minh\s+chống\s+bot",
    re.IGNORECASE,
)
_CHAT_PROBE_CAPTURE_JS = r"""
() => {
  const existing = window.__dolaLoginChatProbe;
  if (existing && existing.installed) return true;
  const state = {
    installed: true,
    requests: 0,
    responses: [],
    errors: [],
  };
  window.__dolaLoginChatProbe = state;
  const originalFetch = window.fetch.bind(window);
  const consume = async (response) => {
    try {
      const body = await response.clone().text();
      state.responses.push({
        ok: response.ok,
        status: response.status,
        url: String(response.url || ''),
        body: body.slice(0, 500000),
      });
    } catch (error) {
      state.errors.push(String(error && error.message || error).slice(0, 300));
    }
  };
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    let url = '';
    try {
      url = String(typeof args[0] === 'string'
        ? args[0]
        : args[0]?.url || response.url || '');
    } catch (error) {
      url = '';
    }
    if (url.includes('/chat/completion')
      || String(response.url || '').includes('/chat/completion')) {
      state.requests += 1;
      consume(response);
    }
    return response;
  };
  return true;
}
"""


def _is_transient_navigation_error(error: Exception) -> bool:
    """Return whether Chromium destroyed the JS world during navigation."""
    message = str(error or "").casefold()
    return (
        "execution context was destroyed" in message
        or "most likely because of a navigation" in message
        or "frame was detached" in message
        or "target page, context or browser has been closed" in message
    )


async def _page_evaluate_with_navigation_retry(page, expression, attempts: int = 4):
    """Evaluate page JavaScript across short-lived client-side navigations."""
    last_error = None
    for attempt in range(max(1, attempts)):
        try:
            return await page.evaluate(expression)
        except Exception as exc:
            last_error = exc
            if not _is_transient_navigation_error(exc) or attempt + 1 >= attempts:
                raise
            await asyncio.sleep(0.35)
    raise last_error


def _chat_probe_normalise(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _chat_probe_event_text(value, depth: int = 0) -> list[str]:
    """Extract visible text fragments from Dola's common SSE event shapes."""
    if depth > 10 or value is None:
        return []
    if isinstance(value, list):
        result = []
        for item in value:
            result.extend(_chat_probe_event_text(item, depth + 1))
        return result
    if not isinstance(value, dict):
        return []

    result = []
    content = value.get("content")
    content_blocks = []
    if isinstance(content, dict):
        content_blocks.extend(content.get("content_block") or [])
    content_blocks.extend(value.get("content_block") or [])
    for block in content_blocks:
        if not isinstance(block, dict):
            continue
        block_content = block.get("content")
        if not isinstance(block_content, dict):
            continue
        for block_name in ("text_block", "thinking_block"):
            block_value = block_content.get(block_name)
            if isinstance(block_value, dict) and block_value.get("text"):
                result.append(str(block_value["text"]))
    for operation in value.get("patch_op") or []:
        if isinstance(operation, dict):
            result.extend(_chat_probe_event_text(
                operation.get("patch_value"), depth + 1
            ))

    for key in ("text_block", "thinking_block"):
        block = value.get(key)
        if isinstance(block, dict) and block.get("text"):
            result.append(str(block["text"]))
    for key in ("text", "answer", "reply", "response_text"):
        text = value.get(key)
        if isinstance(text, str) and text.strip():
            result.append(text)
    for key in ("message", "data", "result", "response"):
        nested = value.get(key)
        if isinstance(nested, (dict, list)):
            result.extend(_chat_probe_event_text(nested, depth + 1))
    return result


def _chat_probe_response_text(raw) -> str:
    """Read assistant text from a JSON or SSE /chat/completion response."""
    source = str(raw or "")
    fragments = []
    for line in source.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            fragments.extend(_chat_probe_event_text(json.loads(data)))
        except (TypeError, json.JSONDecodeError):
            continue
    if not fragments:
        try:
            fragments.extend(_chat_probe_event_text(json.loads(source)))
        except (TypeError, json.JSONDecodeError):
            pass
    return _chat_probe_normalise(" ".join(fragments))


async def _chat_probe_visible_locator(page, selectors):
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
        except Exception:
            continue
        for index in range(count - 1, -1, -1):
            candidate = locator.nth(index)
            try:
                if await candidate.is_visible():
                    return candidate
            except Exception:
                continue
    return None


async def _chat_probe_editor_value(editor) -> str:
    try:
        tag_name = await editor.evaluate("element => element.tagName")
    except Exception:
        tag_name = ""
    try:
        if str(tag_name).upper() in {"TEXTAREA", "INPUT"}:
            return await editor.input_value()
        return await editor.evaluate(
            "element => element.innerText || element.textContent || ''"
        )
    except Exception:
        return ""


async def _chat_probe_fill_editor(page, editor, prompt: str) -> bool:
    try:
        await editor.fill(prompt)
    except Exception:
        try:
            await editor.click(timeout=3000)
            await page.keyboard.press("ControlOrMeta+A")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(prompt, delay=5)
        except Exception:
            return False
    actual = await _chat_probe_editor_value(editor)
    if _chat_probe_normalise(actual) == _chat_probe_normalise(prompt):
        return True
    try:
        await editor.click(timeout=3000)
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(prompt, delay=5)
    except Exception:
        return False
    return _chat_probe_normalise(
        await _chat_probe_editor_value(editor)
    ) == _chat_probe_normalise(prompt)


async def _chat_probe_click_send(page, timeout_ms: int = 5000) -> bool:
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    while True:
        for selector in _CHAT_PROBE_SEND_SELECTORS:
            try:
                locator = page.locator(selector)
                count = await locator.count()
            except Exception:
                continue
            for index in range(count - 1, -1, -1):
                candidate = locator.nth(index)
                try:
                    if not await candidate.is_visible():
                        continue
                    state = await candidate.evaluate(
                        """element => ({
                            disabled: !!element.disabled
                              || String(element.getAttribute('aria-disabled') || '').toLowerCase() === 'true'
                              || String(element.getAttribute('aria-busy') || '').toLowerCase() === 'true'
                        })"""
                    )
                    if state.get("disabled"):
                        continue
                    try:
                        await candidate.click(timeout=1000)
                        return True
                    except Exception:
                        try:
                            await candidate.evaluate("element => element.click()")
                            return True
                        except Exception:
                            await candidate.click(timeout=20000, force=True)
                            return True
                except Exception:
                    continue
        if time.monotonic() >= deadline:
            return False
        await page.wait_for_timeout(100)


async def _chat_probe_dom_text(page, prompt: str) -> str:
    try:
        values = await _page_evaluate_with_navigation_retry(
            page,
            """() => {
                const selectors = [
                    '[data-message-author-role="assistant"]',
                    '[data-role="assistant"]',
                    '[data-author="assistant"]',
                    '[data-testid*="assistant" i]',
                    '[class*="assistant" i]'
                ];
                const result = [];
                for (const selector of selectors) {
                    for (const element of document.querySelectorAll(selector)) {
                        const text = String(element.innerText || element.textContent || '').trim();
                        if (text && !result.includes(text)) result.push(text);
                    }
                }
                return result.slice(-8);
            }"""
        )
    except Exception:
        return ""
    if not isinstance(values, list):
        return ""
    prompt_key = _chat_probe_normalise(prompt).casefold()
    for value in reversed(values):
        text = _chat_probe_normalise(value)
        if text and text.casefold() != prompt_key:
            return text
    return ""


def _chat_probe_result_is_valid(text: str) -> bool:
    value = _chat_probe_normalise(text)
    return bool(value and not _CHAT_PROBE_FAILURE_PATTERN.search(value))


async def verify_dola_chat_response(
    account: str,
    profile_dir: str | Path | None = None,
    proxy: dict | str | None = None,
    timeout_sec: float | None = None,
) -> dict:
    """Verify a freshly logged-in profile by receiving one normal chat reply.

    Cookie presence alone can survive a Dola logout/risk wall. This probe uses
    the same persistent profile to send a harmless question and requires an
    assistant response before reporting a successful login.
    """
    from patchright.async_api import async_playwright

    verify_timeout = max(
        15.0,
        float(
            timeout_sec
            if timeout_sec is not None
            else getattr(config, "LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC", 60)
        ),
    )
    async with async_playwright() as p:
        context = await launch_account_context(
            p,
            account,
            headless=True,
            profile_dir=profile_dir,
            proxy=proxy,
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(
                "https://www.dola.com/chat",
                timeout=60000,
                wait_until="domcontentloaded",
            )
            await page.wait_for_timeout(3500)
            cookies = await context.cookies("https://www.dola.com")
            session_cookie = has_dola_session(cookies)
            login_ui = await _page_has_logged_out_marker(page)
            url = str(page.url or "")
            risk_control = bool(
                session_cookie and (login_ui or "from_logout" in url)
            )
            base = {
                "ok": False,
                "response_seen": False,
                "request_seen": False,
                "response_text": "",
                "session_cookie": session_cookie,
                "login_ui": login_ui,
                "risk_control": risk_control,
                "url": url,
                "error": "",
            }
            await _page_evaluate_with_navigation_retry(page, _CHAT_PROBE_CAPTURE_JS)
            # A stale/animated header Login marker is exactly the false
            # negative this probe is meant to resolve. Prefer a real chat
            # editor over that marker; never use a generic login-dialog
            # textbox as the probe input.
            editor_selectors = (
                _CHAT_PROBE_EDITOR_SELECTORS[:3]
                if login_ui
                else _CHAT_PROBE_EDITOR_SELECTORS
            )
            editor = await _chat_probe_visible_locator(
                page, editor_selectors
            )
            if editor is None:
                base["error"] = (
                    "Dola vẫn hiển thị màn hình đăng nhập"
                    if not risk_control
                    else "Dola hiển thị risk-control/login wall dù cookie còn"
                )
                return base
            if not await _chat_probe_fill_editor(page, editor, DOLA_LOGIN_PROBE_PROMPT):
                base["error"] = "Không điền được câu hỏi kiểm tra đăng nhập"
                return base

            try:
                await page.keyboard.press("Enter")
            except Exception:
                pass
            await page.wait_for_timeout(900)
            try:
                state = await _page_evaluate_with_navigation_retry(
                    page,
                    """() => {
                        const value = window.__dolaLoginChatProbe || {};
                        return {
                            requests: Number(value.requests || 0),
                            responses: Array.isArray(value.responses) ? value.responses : [],
                            errors: Array.isArray(value.errors) ? value.errors : []
                        };
                    }"""
                )
            except Exception as exc:
                if not _is_transient_navigation_error(exc):
                    raise
                state = {}
            request_seen = bool(state.get("requests"))
            if not request_seen:
                await _chat_probe_click_send(page, timeout_ms=5000)

            deadline = time.monotonic() + verify_timeout
            last_error = ""
            while time.monotonic() < deadline:
                try:
                    state = await _page_evaluate_with_navigation_retry(
                        page,
                        """() => {
                            const value = window.__dolaLoginChatProbe || {};
                            return {
                                requests: Number(value.requests || 0),
                                responses: Array.isArray(value.responses) ? value.responses : [],
                                errors: Array.isArray(value.errors) ? value.errors : []
                            };
                        }"""
                    )
                except Exception as exc:
                    if not _is_transient_navigation_error(exc):
                        raise
                    await page.wait_for_timeout(500)
                    continue
                request_seen = request_seen or bool(state.get("requests"))
                for response in state.get("responses") or []:
                    raw_text = _chat_probe_response_text(response.get("body"))
                    if _chat_probe_result_is_valid(raw_text):
                        return {
                            **base,
                            "ok": True,
                            "response_seen": True,
                            "request_seen": request_seen,
                            "response_text": raw_text[:300],
                        }
                    if not response.get("ok", False):
                        last_error = (
                            f"Dola chat HTTP {response.get('status', 'unknown')}"
                        )
                    elif response.get("body"):
                        last_error = "Dola chat không trả về nội dung trợ lý hợp lệ"

                dom_text = await _chat_probe_dom_text(
                    page, DOLA_LOGIN_PROBE_PROMPT
                )
                if _chat_probe_result_is_valid(dom_text):
                    return {
                        **base,
                        "ok": True,
                        "response_seen": True,
                        "request_seen": request_seen,
                        "response_text": dom_text[:300],
                    }
                if state.get("errors"):
                    last_error = str(state["errors"][-1])[:240]
                if state.get("responses") and last_error:
                    break
                await page.wait_for_timeout(400)

            base.update({
                "response_seen": bool(state.get("responses")),
                "request_seen": request_seen,
                "error": last_error or (
                    "Dola không phản hồi câu hỏi kiểm tra trong "
                    f"{int(verify_timeout)}s"
                ),
            })
            return base
        finally:
            await context.close()
