"""Non-secret Google identity metadata stored alongside a browser profile.

Chromium keeps the actual Google session in its encrypted cookie/profile data.
This module stores only the selected Gmail address as a small diagnostic marker
so the Gateway can distinguish a saved Google identity from the Dola session
cookie. Passwords, TOTP secrets and cookie values never go into this file.
"""

import json
import os
import re
import uuid
from pathlib import Path


PROFILE_IDENTITY_FILENAME = "DolaProfileIdentity.json"
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)


def canonical_google_email(value: str) -> str:
    """Return a comparison form for a Google email address.

    Gmail treats dots and plus-tags in the local part as aliases. Google
    Workspace addresses do not have that guarantee, so only gmail.com and
    googlemail.com receive this normalization.
    """
    address = str(value or "").strip().casefold()
    if "@" not in address:
        return address
    local, domain = address.rsplit("@", 1)
    if domain in {"gmail.com", "googlemail.com"}:
        local = local.split("+", 1)[0].replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def google_emails_match(left: str, right: str) -> bool:
    """Compare two Google identities without confusing Gmail dot aliases."""
    left_value = canonical_google_email(left)
    right_value = canonical_google_email(right)
    return bool(left_value and right_value and left_value == right_value)


def extract_email_addresses(text: str) -> set[str]:
    """Extract email-shaped strings without exposing their values in logs."""
    return {value.casefold() for value in EMAIL_RE.findall(str(text or ""))}


def _email_from_preferences(profile_dir: Path) -> str:
    path = profile_dir / "Default" / "Preferences"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return ""

    account_info = data.get("account_info") if isinstance(data, dict) else None
    if isinstance(account_info, list):
        for item in account_info:
            if not isinstance(item, dict):
                continue
            email = str(item.get("email") or "").strip()
            if EMAIL_RE.fullmatch(email):
                return email
    return ""


def _email_from_marker(profile_dir: Path) -> str:
    path = profile_dir / PROFILE_IDENTITY_FILENAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return ""
    email = str(data.get("email") or "").strip() if isinstance(data, dict) else ""
    return email if EMAIL_RE.fullmatch(email) else ""


def read_google_profile_email(profile_dir: str | Path) -> str:
    """Read the non-secret Google identity persisted by Chromium/profile flow."""
    profile_path = Path(profile_dir)
    # Preferences contains Google's canonical displayed address. Prefer it so
    # Gmail dot aliases are visible to the operator instead of being hidden by
    # the normalized input stored in pool_usage.db.
    return _email_from_preferences(profile_path) or _email_from_marker(profile_path)


def save_google_profile_identity(profile_dir: str | Path, email: str) -> bool:
    """Persist only the selected Google email after a successful OAuth flow."""
    address = str(email or "").strip()
    if not EMAIL_RE.fullmatch(address):
        return False

    profile_path = Path(profile_dir)
    profile_path.mkdir(parents=True, exist_ok=True)
    target = profile_path / PROFILE_IDENTITY_FILENAME
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    payload = {
        "provider": "google",
        "email": address,
        "canonical_email": canonical_google_email(address),
    }
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            raise
        os.replace(temporary, target)
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
        return True
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def google_profile_identity(profile_dir: str | Path) -> dict[str, str | bool]:
    """Return safe identity metadata for the dashboard/account diagnostics."""
    email = read_google_profile_email(profile_dir)
    return {
        "google_email": email,
        "google_identity_saved": bool(email),
    }
