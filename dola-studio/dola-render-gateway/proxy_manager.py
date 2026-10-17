"""Managed proxy profiles and per-account assignments.

The Facebook publisher keeps proxy profiles separate from the objects that use
them.  Dola follows the same model: a proxy can be imported/tested once and
then assigned to any number of local Chromium profiles.  Passwords are
encrypted with the existing Gateway credential key and are never returned by
the admin API.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote, urlencode, urlparse
from urllib.error import HTTPError
from urllib.request import urlopen

import aiohttp

import config
from credential_store import AccountCredentialStore, CredentialStoreError


SUPPORTED_PROTOCOLS = ("HTTP", "HTTPS", "SOCKS5")
SUPPORTED_MODES = ("rotating", "static")
MAX_BULK_LINES = 1000
MAX_TEST_ITEMS = 200
TEST_CONCURRENCY = 5
# Keep the checker configurable for an operator who mirrors the service, while
# using the same checker exposed by the FB Publisher workflow by default.
PROXY_CHECK_URL = str(
    getattr(
        config,
        "PROXYFB_IP_CHECK_URL",
        os.getenv("DOLA_PROXY_CHECK_URL", "https://proxyfb.com/check.php"),
    )
).strip() or "https://proxyfb.com/check.php"
DEFAULT_TEST_URL = "https://www.dola.com/"
# ProxyFB's rotating API is documented with the plain HTTP API host.  Keep the
# base URL configurable because some deployments expose a compatible HTTPS
# mirror or route the API through an internal egress.
PROXYFB_API_BASE_URL = str(
    getattr(config, "PROXYFB_API_BASE_URL", "http://api.proxyfb.com/api")
).rstrip("/")
PROXYFB_API_TIMEOUT_SEC = max(
    3.0, float(getattr(config, "PROXYFB_API_TIMEOUT_SEC", 12))
)
PROXYFB_REFRESH_MARGIN_SEC = max(
    0.0, float(getattr(config, "PROXYFB_REFRESH_MARGIN_SEC", 15))
)
PROXYFB_IP_CHECK_TIMEOUT_SEC = max(
    3.0, float(getattr(config, "PROXYFB_IP_CHECK_TIMEOUT_SEC", 15))
)
PROXYFB_IP_ACTIVATION_WAIT_SEC = max(
    0.0, float(getattr(config, "PROXYFB_IP_ACTIVATION_WAIT_SEC", 60))
)
PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC = max(
    PROXYFB_IP_ACTIVATION_WAIT_SEC,
    float(getattr(config, "PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC", 120)),
)
PROXYFB_IP_CHECK_INTERVAL_SEC = max(
    1.0, float(getattr(config, "PROXYFB_IP_CHECK_INTERVAL_SEC", 10))
)
PROXYFB_IP_CHECK_MAX_ATTEMPTS = max(
    1, min(16, int(getattr(config, "PROXYFB_IP_CHECK_MAX_ATTEMPTS", 7)))
)
PROXYFB_IP_CHECK_CACHE_SEC = max(
    0.0, float(getattr(config, "PROXYFB_IP_CHECK_CACHE_SEC", 30))
)
MAX_PROXYFB_LINES = 50
_DB_LOCK = threading.RLock()
_PROXYFB_LOCKS: dict[str, threading.Lock] = {}
_PROXYFB_LOCKS_GUARD = threading.Lock()


class ProxyValidationError(ValueError):
    """Raised when a managed proxy value is malformed."""


class ProxyFBError(RuntimeError):
    """Raised when ProxyFB cannot return a usable rotating endpoint."""


class ProxyLeaseExpiringError(ProxyFBError):
    """Raised before a video starts when a rotating lease is too short."""


@dataclass(frozen=True)
class ParsedProxy:
    protocol: str
    mode: str
    host: str
    port: int
    username: str = ""
    password: str = ""


def _clean_text(value, limit: int = 255) -> str:
    return str(value or "").strip()[:limit]


def _normalize_protocol(value: str | None, default: str = "HTTP") -> str:
    protocol = _clean_text(value or default, 16).upper()
    if protocol not in SUPPORTED_PROTOCOLS:
        raise ProxyValidationError("Protocol proxy phải là HTTP, HTTPS hoặc SOCKS5.")
    return protocol


def _normalize_mode(value: str | None, default: str = "rotating") -> str:
    mode = _clean_text(value or default, 16).lower()
    aliases = {"rotate": "rotating", "dynamic": "rotating", "fixed": "static"}
    mode = aliases.get(mode, mode)
    if mode not in SUPPORTED_MODES:
        raise ProxyValidationError("Loại proxy phải là rotating hoặc static.")
    return mode


def _normalize_host(value: str) -> str:
    host = _clean_text(value, 255)
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    if not host or any(char.isspace() for char in host) or any(
        char in "\\/@?#" for char in host
    ):
        raise ProxyValidationError("Host proxy không hợp lệ.")
    if not re.fullmatch(r"[A-Za-z0-9._:%-]+", host):
        raise ProxyValidationError("Host proxy chứa ký tự không hợp lệ.")
    return host


def _normalize_port(value) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise ProxyValidationError("Port proxy không hợp lệ.") from exc
    if not 1 <= port <= 65535:
        raise ProxyValidationError("Port proxy phải nằm trong khoảng 1-65535.")
    return port


def _parse_proxy_url(line: str, protocol: str, mode: str) -> ParsedProxy:
    parsed = urlparse(line if "://" in line else f"{protocol.lower()}://{line}")
    if parsed.scheme.lower() not in {item.lower() for item in SUPPORTED_PROTOCOLS}:
        raise ProxyValidationError("Scheme proxy phải là http, https hoặc socks5.")
    host = _normalize_host(parsed.hostname or "")
    port = _normalize_port(parsed.port)
    return ParsedProxy(
        protocol=parsed.scheme.upper(),
        mode=mode,
        host=host,
        port=port,
        username=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
    )


def parse_proxy_line(line: str, *, protocol: str = "HTTP", mode: str = "rotating") -> ParsedProxy:
    """Parse a URL or the FB Publisher ``host:port:user:password`` format."""
    default_protocol = _normalize_protocol(protocol)
    normalized_mode = _normalize_mode(mode)
    text = _clean_text(line, 4096)
    if not text:
        raise ProxyValidationError("Dòng proxy trống.")
    if "://" in text:
        return _parse_proxy_url(text, default_protocol, normalized_mode)

    # Accept comma/tab separated values as a convenience when pasting a
    # spreadsheet, while retaining the original colon format used by FB.
    separator = "," if "," in text else ("\t" if "\t" in text else ":")
    parts = [part.strip() for part in text.split(separator)]
    if len(parts) < 2:
        raise ProxyValidationError("Cú pháp phải là host:port:user:password hoặc URL proxy.")
    host, port = parts[0], parts[1]
    username = parts[2] if len(parts) >= 3 else ""
    password = separator.join(parts[3:]) if len(parts) >= 4 else ""
    return ParsedProxy(
        protocol=default_protocol,
        mode=normalized_mode,
        host=_normalize_host(host),
        port=_normalize_port(port),
        username=_clean_text(username),
        password=_clean_text(password, 1024),
    )


def parse_bulk_proxy_text(
    value: str,
    *,
    protocol: str = "HTTP",
    mode: str = "rotating",
    max_lines: int = MAX_BULK_LINES,
) -> tuple[list[tuple[int, ParsedProxy]], list[dict]]:
    entries: list[tuple[int, ParsedProxy]] = []
    errors: list[dict] = []
    meaningful = 0
    for line_number, raw in enumerate(str(value or "").splitlines(), 1):
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        meaningful += 1
        if meaningful > max_lines:
            errors.append({"line": line_number, "message": f"Vượt quá giới hạn {max_lines} dòng."})
            continue
        try:
            entries.append((line_number, parse_proxy_line(text, protocol=protocol, mode=mode)))
        except (ProxyValidationError, ValueError) as exc:
            errors.append({"line": line_number, "message": str(exc)[:240]})
    return entries, errors


def _record_identity(host: str, port: int, username: str) -> str:
    """Return the FB Publisher-compatible endpoint identity.

    The protocol is deliberately excluded: re-importing the same host, port,
    and username updates the existing record even when the operator changes
    HTTP/HTTPS/SOCKS5 for that endpoint.
    """
    return f"{host.lower()}|{int(port)}|{username}"


def _proxy_url(record: dict, password: str = "") -> str:
    protocol = str(record.get("protocol") or "HTTP").lower()
    host = str(record.get("host") or "")
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    auth = ""
    username = str(record.get("username") or "")
    if username:
        auth = quote(username, safe="")
        if password:
            auth += ":" + quote(password, safe="")
        auth += "@"
    return f"{protocol}://{auth}{host}:{int(record.get('port') or 0)}"


def _checker_line(record: dict, password: str = "") -> str:
    """Serialize a record to ProxyFB's ``host:port[:username:password]`` form."""
    host = str(record.get("host") or "")
    port = int(record.get("port") or 0)
    username = str(record.get("username") or "")
    if not username and not password:
        return f"{host}:{port}"
    return f"{host}:{port}:{username}:{password}"


def _normalize_proxyfb_key(value: str) -> str:
    key = _clean_text(value, 255)
    if not key or any(char.isspace() for char in key):
        raise ProxyValidationError("ProxyFB API key không được để trống hoặc chứa khoảng trắng.")
    return key


def _normalize_proxyfb_location(value: str | int | None, *, required: bool = False) -> str:
    location = _clean_text(value, 32)
    if required and not location:
        raise ProxyValidationError("Hãy nhập location_id của ProxyFB.")
    if location and not re.fullmatch(r"[A-Za-z0-9_-]+", location):
        raise ProxyValidationError("location_id ProxyFB không hợp lệ.")
    return location


def parse_proxyfb_line(
    line: str, *, default_location: str = ""
) -> tuple[str, str]:
    """Parse ``api_key`` or ``api_key|location_id`` bulk input."""
    text = _clean_text(line, 4096)
    if not text or text.startswith("#"):
        raise ProxyValidationError("Dòng ProxyFB trống.")
    # Pipes are the unambiguous form. Commas and whitespace are accepted for
    # spreadsheet pastes; API keys themselves are treated as opaque tokens.
    if "|" in text:
        key, location = text.split("|", 1)
    elif "," in text:
        key, location = text.split(",", 1)
    else:
        pieces = text.split()
        key, location = (pieces[0], pieces[1]) if len(pieces) >= 2 else (text, default_location)
    return _normalize_proxyfb_key(key), _normalize_proxyfb_location(location or default_location)


def parse_bulk_proxyfb_text(
    value: str,
    *,
    default_location: str = "",
    max_lines: int = MAX_PROXYFB_LINES,
) -> tuple[list[tuple[int, str, str]], list[dict]]:
    entries: list[tuple[int, str, str]] = []
    errors: list[dict] = []
    meaningful = 0
    for line_number, raw in enumerate(str(value or "").splitlines(), 1):
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        meaningful += 1
        if meaningful > max_lines:
            errors.append({"line": line_number, "message": f"Vượt quá giới hạn {max_lines} key ProxyFB."})
            continue
        try:
            key, location = parse_proxyfb_line(text, default_location=default_location)
            entries.append((line_number, key, location))
        except (ProxyValidationError, ValueError) as exc:
            errors.append({"line": line_number, "message": str(exc)[:240]})
    return entries, errors


def _seconds(value) -> float:
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


def _proxyfb_result(payload: dict, *, action: str) -> dict:
    """Normalize both the documented and current ProxyFB error shapes."""
    if not isinstance(payload, dict) or payload.get("success") is not True:
        message = "ProxyFB không trả về proxy."
        if isinstance(payload, dict):
            message = str(
                payload.get("description")
                or payload.get("message")
                or payload.get("error")
                or message
            )
        raise ProxyFBError(f"ProxyFB {action} thất bại: {message[:240]}")
    raw_proxy = str(payload.get("proxy") or "").strip()
    if ":" not in raw_proxy:
        raise ProxyFBError("ProxyFB trả về proxy không có dạng IP:port.")
    try:
        endpoint = parse_proxy_line(raw_proxy, protocol="HTTP", mode="rotating")
    except ProxyValidationError as exc:
        raise ProxyFBError(f"ProxyFB trả về endpoint không hợp lệ: {exc}") from exc
    now = time.time()
    timeout = _seconds(payload.get("timeout"))
    return {
        "host": endpoint.host,
        "port": endpoint.port,
        "location_id": _normalize_proxyfb_location(payload.get("location")),
        "next_change_at": now + _seconds(payload.get("next_change")),
        "timeout_at": now + timeout if timeout else 0.0,
        "raw": payload,
    }


class ProxyManager:
    """SQLite-backed managed proxy registry."""

    def __init__(self, db_path: str | Path = "pool_usage.db"):
        self.db_path = str(db_path)
        self._conn = sqlite3.connect(
            self.db_path, timeout=30, check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout=30000")
        try:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.OperationalError:
            pass
        self._cipher = self._load_cipher()
        self._init_schema()

    @staticmethod
    def _load_cipher():
        try:
            return AccountCredentialStore()._fernet
        except (CredentialStoreError, AttributeError) as exc:
            raise RuntimeError("Không thể khởi tạo kho mã hóa mật khẩu proxy") from exc

    def _init_schema(self):
        with _DB_LOCK:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS proxy_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    protocol TEXT NOT NULL DEFAULT 'HTTP',
                    mode TEXT NOT NULL DEFAULT 'rotating',
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL DEFAULT '',
                    password_encrypted TEXT DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual',
                    source_key_encrypted TEXT DEFAULT '',
                    source_key_fingerprint TEXT DEFAULT '',
                    location_id TEXT DEFAULT '',
                    proxy_next_change_at REAL DEFAULT 0,
                    proxy_timeout_at REAL DEFAULT 0,
                    proxy_last_rotated_at REAL DEFAULT 0,
                    proxy_retry_at REAL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'unknown',
                    last_checked_at REAL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            proxy_columns = {
                row[1] for row in self._conn.execute("PRAGMA table_info(proxy_profiles)").fetchall()
            }
            # Keep existing manually imported proxy rows intact while adding
            # the metadata required by ProxyFB's key-based rotating API.
            for column, definition in (
                ("source", "TEXT NOT NULL DEFAULT 'manual'"),
                ("source_key_encrypted", "TEXT DEFAULT ''"),
                ("source_key_fingerprint", "TEXT DEFAULT ''"),
                ("location_id", "TEXT DEFAULT ''"),
                ("proxy_next_change_at", "REAL DEFAULT 0"),
                ("proxy_timeout_at", "REAL DEFAULT 0"),
                ("proxy_last_rotated_at", "REAL DEFAULT 0"),
                ("proxy_retry_at", "REAL DEFAULT 0"),
            ):
                if column not in proxy_columns:
                    self._conn.execute(
                        f"ALTER TABLE proxy_profiles ADD COLUMN {column} {definition}"
                    )
            # A standalone manager (for example, an admin migration command)
            # may be initialized before BrowserPool has created its metadata
            # table. Mirror the pool's complete metadata shape so either
            # initialization order remains safe.
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS accounts_meta (
                    name TEXT PRIMARY KEY,
                    scheduling INTEGER DEFAULT 1,
                    note TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    created_at REAL,
                    last_used_at REAL DEFAULT 0,
                    login_ok INTEGER,
                    login_checked_at REAL DEFAULT 0,
                    cooldown_until REAL DEFAULT 0,
                    cooldown_reason TEXT DEFAULT '',
                    cooldown_auto_restore INTEGER DEFAULT 0,
                    rate_limited_until REAL DEFAULT 0,
                    limit_reason TEXT DEFAULT '',
                    quota_blocked_until REAL DEFAULT 0,
                    quota_reason TEXT DEFAULT '',
                    credit_balance INTEGER,
                    credit_checked_at REAL DEFAULT 0,
                    cooldown_global INTEGER DEFAULT 0,
                    proxy_id TEXT DEFAULT '',
                    proxy_updated_at REAL DEFAULT 0
                )
                """
            )
            columns = {
                row[1] for row in self._conn.execute("PRAGMA table_info(accounts_meta)").fetchall()
            }
            if columns:
                if "proxy_id" not in columns:
                    self._conn.execute("ALTER TABLE accounts_meta ADD COLUMN proxy_id TEXT DEFAULT ''")
                if "proxy_updated_at" not in columns:
                    self._conn.execute("ALTER TABLE accounts_meta ADD COLUMN proxy_updated_at REAL DEFAULT 0")
            self._conn.commit()

    def _encrypt(self, value: str) -> str:
        if not value:
            return ""
        return self._cipher.encrypt(value.encode("utf-8")).decode("ascii")

    def _decrypt(self, token: str) -> str:
        if not token:
            return ""
        try:
            return self._cipher.decrypt(token.encode("ascii")).decode("utf-8")
        except Exception as exc:
            raise RuntimeError("Không thể giải mã mật khẩu proxy; hãy cập nhật lại proxy") from exc

    @staticmethod
    def _validate_fields(fields: dict) -> dict:
        return {
            "name": _clean_text(fields.get("name"), 80) or "Proxy",
            "protocol": _normalize_protocol(fields.get("protocol")),
            "mode": _normalize_mode(fields.get("mode")),
            "host": _normalize_host(fields.get("host")),
            "port": _normalize_port(fields.get("port")),
            "username": _clean_text(fields.get("username"), 255),
        }

    def _row(self, proxy_id: str):
        return self._conn.execute(
            "SELECT * FROM proxy_profiles WHERE id=?", (str(proxy_id),)
        ).fetchone()

    def _password_from_row(self, row) -> str:
        return self._decrypt(str(row["password_encrypted"] or ""))

    def _public_row(self, row) -> dict:
        assigned = self._conn.execute(
            "SELECT COUNT(*) FROM accounts_meta WHERE proxy_id=?", (row["id"],)
        ).fetchone()[0]
        return {
            "id": row["id"],
            "name": row["name"],
            "protocol": row["protocol"],
            "mode": row["mode"],
            "host": row["host"],
            "port": int(row["port"]),
            "username": row["username"] or "",
            "has_password": bool(row["password_encrypted"]),
            "source": row["source"] or "manual",
            "location_id": row["location_id"] or "",
            "proxy_next_change_at": float(row["proxy_next_change_at"] or 0),
            "proxy_timeout_at": float(row["proxy_timeout_at"] or 0),
            "proxy_last_rotated_at": float(row["proxy_last_rotated_at"] or 0),
            "proxy_retry_at": float(row["proxy_retry_at"] or 0),
            "proxyfb_configured": bool(row["source"] == "proxyfb" and row["source_key_encrypted"]),
            "enabled": bool(row["enabled"]),
            "status": row["status"] or "unknown",
            "last_checked_at": float(row["last_checked_at"] or 0),
            "last_error": row["last_error"] or "",
            "assigned_profiles": int(assigned or 0),
            "created_at": float(row["created_at"] or 0),
            "updated_at": float(row["updated_at"] or 0),
            "endpoint": _proxy_url(dict(row)),
        }

    def list_public(self) -> list[dict]:
        with _DB_LOCK:
            return [self._public_row(row) for row in self._conn.execute(
                "SELECT * FROM proxy_profiles ORDER BY updated_at DESC, name COLLATE NOCASE"
            ).fetchall()]

    def summary(self) -> dict:
        items = self.list_public()
        return {
            "total": len(items),
            "enabled": sum(1 for item in items if item["enabled"]),
            "healthy": sum(1 for item in items if item["status"] == "healthy"),
            "errors": sum(1 for item in items if item["status"] == "error"),
            "rotating": sum(1 for item in items if item["mode"] == "rotating"),
            "assigned": sum(item["assigned_profiles"] for item in items),
        }

    def _upsert(self, fields: dict, password: str | None = None, proxy_id: str | None = None):
        normalized = self._validate_fields(fields)
        now = time.time()
        with _DB_LOCK:
            existing = None
            if proxy_id:
                existing = self._row(proxy_id)
            if existing is None:
                existing = self._conn.execute(
                    "SELECT * FROM proxy_profiles WHERE lower(host)=lower(?) "
                    "AND port=? AND username=? AND COALESCE(source, 'manual')='manual' "
                    "ORDER BY updated_at DESC LIMIT 1",
                    (normalized["host"], normalized["port"], normalized["username"]),
                ).fetchone()
            if existing:
                item_id = existing["id"]
                secret = (
                    self._encrypt(str(password))
                    if password is not None
                    else str(existing["password_encrypted"] or "")
                )
                self._conn.execute(
                    "UPDATE proxy_profiles SET name=?, protocol=?, mode=?, host=?, port=?, username=?, "
                    "password_encrypted=?, source='manual', source_key_encrypted='', "
                    "source_key_fingerprint='', location_id='', proxy_next_change_at=0, "
                    "proxy_timeout_at=0, proxy_last_rotated_at=0, proxy_retry_at=0, "
                    "status='unknown', "
                    "last_checked_at=0, last_error='', updated_at=? WHERE id=?",
                    (*normalized.values(), secret, now, item_id),
                )
                action = "updated"
            else:
                item_id = proxy_id or f"proxy_{uuid.uuid4().hex[:16]}"
                self._conn.execute(
                    "INSERT INTO proxy_profiles "
                    "(id,name,protocol,mode,host,port,username,password_encrypted,enabled,status,last_checked_at,last_error,created_at,updated_at) "
                    "VALUES (?,?,?,?,?,?,?,? ,1,'unknown',0,'',?,?)",
                    (item_id, *normalized.values(), self._encrypt(str(password or "")), now, now),
                )
                action = "created"
            self._conn.commit()
            return action, self._public_row(self._row(item_id))

    def bulk_upsert(self, text: str, *, protocol: str = "HTTP", mode: str = "rotating", name_prefix: str = "Proxy") -> dict:
        entries, errors = parse_bulk_proxy_text(text, protocol=protocol, mode=mode)
        created: list[dict] = []
        updated: list[dict] = []
        seen: set[str] = set()
        prefix = _clean_text(name_prefix, 40) or "Proxy"
        for index, (line_number, entry) in enumerate(entries, 1):
            identity = _record_identity(entry.host, entry.port, entry.username)
            if identity in seen:
                errors.append({"line": line_number, "message": "Dòng trùng trong cùng một lần nhập."})
                continue
            seen.add(identity)
            try:
                action, item = self._upsert(
                    {
                        "name": f"{prefix} {index}",
                        "protocol": entry.protocol,
                        "mode": entry.mode,
                        "host": entry.host,
                        "port": entry.port,
                        "username": entry.username,
                    },
                    # A blank password in a re-import means "leave the
                    # existing secret alone"; this mirrors the edit form and
                    # avoids accidentally erasing credentials when a
                    # spreadsheet omits the password column. New records
                    # still receive an empty password.
                    password=entry.password or None,
                )
                (created if action == "created" else updated).append(item)
            except Exception as exc:
                errors.append({"line": line_number, "message": str(exc)[:240]})
        return {
            "created": created,
            "updated": updated,
            "errors": errors,
            "summary": {"created": len(created), "updated": len(updated), "errors": len(errors)},
        }

    @staticmethod
    def _proxyfb_lock(proxy_id: str) -> threading.Lock:
        with _PROXYFB_LOCKS_GUARD:
            return _PROXYFB_LOCKS.setdefault(str(proxy_id), threading.Lock())

    @staticmethod
    def _proxyfb_fingerprint(api_key: str) -> str:
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()

    @staticmethod
    def _proxyfb_api_request(
        api_key: str, action: str, *, location_id: str = ""
    ) -> dict:
        """Call ProxyFB's documented key-based endpoint without logging the key."""
        if action not in {"getProxy", "changeProxy"}:
            raise ProxyFBError("ProxyFB action không hợp lệ.")
        query = {"key": api_key}
        if action == "changeProxy":
            query["location"] = location_id
        url = f"{PROXYFB_API_BASE_URL}/{action}.php?{urlencode(query)}"
        try:
            with urlopen(url, timeout=PROXYFB_API_TIMEOUT_SEC) as response:
                raw = response.read(256 * 1024)
            payload = json.loads(raw.decode("utf-8-sig"))
        except HTTPError as exc:
            # ProxyFB currently uses HTTP 404 for an invalid key while the
            # documented response shape puts the useful explanation in JSON.
            # Preserve that explanation instead of exposing a bare HTTPError.
            try:
                raw = exc.read(256 * 1024)
                payload = json.loads(raw.decode("utf-8-sig"))
            except Exception:
                raise ProxyFBError(
                    f"ProxyFB {action} trả về HTTP {exc.code}."
                ) from exc
            return _proxyfb_result(payload, action=action)
        except ProxyFBError:
            raise
        except Exception as exc:
            raise ProxyFBError(
                f"Không kết nối được ProxyFB ({action}): {type(exc).__name__}."
            ) from exc
        return _proxyfb_result(payload, action=action)

    def _proxyfb_key_from_row(self, row) -> str:
        token = str(row["source_key_encrypted"] or "")
        if not token:
            raise ProxyFBError("Profile ProxyFB chưa có API key.")
        try:
            return self._decrypt(token)
        except Exception as exc:
            raise ProxyFBError("Không thể giải mã API key ProxyFB; hãy nhập lại key.") from exc

    def _check_proxyfb_exit_ip(self, row) -> str:
        """Check one exact endpoint through ProxyFB's own checker."""
        try:
            # ``_test_batch`` already uses the documented multipart contract
            # for https://proxyfb.com/check.php. Run it in this worker thread
            # so rotation remains synchronous and does not block Uvicorn.
            result = asyncio.run(
                self._test_batch([row], PROXYFB_IP_CHECK_TIMEOUT_SEC)
            )[0]
        except Exception as exc:
            raise ProxyFBError(
                f"Không kiểm tra được proxy qua proxyfb.com/check.php: "
                f"{type(exc).__name__}."
            ) from exc
        if not result.get("ok"):
            message = str(result.get("message") or "Proxy Checker không xác nhận proxy hoạt động.")
            raise ProxyFBError(
                f"proxyfb.com/check.php không xác nhận proxy hoạt động: {message[:200]}"
            )
        return str(row["host"] or "").strip()

    @staticmethod
    def _proxyfb_check_offsets() -> tuple[float, ...]:
        """Return activation checkpoints, including the hard final deadline."""
        first = max(0.0, PROXYFB_IP_ACTIVATION_WAIT_SEC)
        deadline = max(first, PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC)
        attempts = max(1, PROXYFB_IP_CHECK_MAX_ATTEMPTS)
        if attempts == 1:
            return (deadline,)

        regular = []
        offset = first
        while offset <= deadline + 1e-6 and len(regular) < attempts:
            regular.append(offset)
            offset += PROXYFB_IP_CHECK_INTERVAL_SEC
        if len(regular) == attempts and regular[-1] < deadline - 1e-6:
            # If an operator lowers the attempt count, retain both the first
            # check and the hard final deadline (e.g. 60/80/100/120 for 4).
            step = (deadline - first) / (attempts - 1)
            return tuple(first + step * index for index in range(attempts))
        if regular[-1] < deadline - 1e-6:
            regular.append(deadline)
        return tuple(regular)

    def _wait_and_check_proxyfb_endpoint(
        self, row, *, changed_at: float = 0.0, force_check: bool = False
    ) -> str:
        """Check an endpoint, polling activation until 120s after a change."""
        checked_at = _seconds(row["last_checked_at"] if "last_checked_at" in row.keys() else 0)
        if not force_check and row["status"] == "healthy" and checked_at:
            if time.time() - checked_at <= PROXYFB_IP_CHECK_CACHE_SEC:
                return str(row["host"] or "")

        # A newly returned endpoint gets the delayed retry schedule. A
        # just-in-time health check of an already-running endpoint is checked
        # immediately so every render does not wait another minute.
        offsets = self._proxyfb_check_offsets() if changed_at else (0.0,)
        last_error = None
        for offset in offsets:
            if changed_at:
                remaining = changed_at + offset - time.time()
                if remaining > 0:
                    time.sleep(remaining)
            try:
                return self._check_proxyfb_exit_ip(row)
            except Exception as exc:
                last_error = exc

        if last_error is not None:
            raise ProxyFBError(
                f"{last_error} Đã kiểm tra {len(offsets)} lần trong tối đa "
                f"{PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC:g}s sau khi đổi IP."
            ) from last_error
        raise ProxyFBError("ProxyFB checker không trả về kết quả kiểm tra.")

    def _mark_proxyfb_ip_verified(self, proxy_id: str, checked_at: float | None = None):
        now = time.time() if checked_at is None else float(checked_at)
        with _DB_LOCK:
            self._conn.execute(
                "UPDATE proxy_profiles SET status='healthy', last_checked_at=?, "
                "last_error='', proxy_retry_at=0, updated_at=? WHERE id=?",
                (now, now, str(proxy_id)),
            )
            self._conn.commit()
            return self._row(proxy_id)

    def _save_proxyfb_endpoint(
        self,
        row,
        endpoint: dict,
        *,
        requested_location: str = "",
        rotated_at: float | None = None,
    ):
        now = time.time()
        location = endpoint.get("location_id") or requested_location or str(row["location_id"] or "")
        rotation_timestamp = now if rotated_at is None else float(rotated_at)
        with _DB_LOCK:
            self._conn.execute(
                "UPDATE proxy_profiles SET protocol='HTTP', mode='rotating', host=?, port=?, "
                "source='proxyfb', location_id=?, proxy_next_change_at=?, proxy_timeout_at=?, "
                "proxy_last_rotated_at=?, proxy_retry_at=0, status='unknown', "
                "last_checked_at=0, last_error='', "
                "updated_at=? WHERE id=?",
                (
                    endpoint["host"],
                    endpoint["port"],
                    location,
                    float(endpoint.get("next_change_at") or 0),
                    float(endpoint.get("timeout_at") or 0),
                    rotation_timestamp,
                    now,
                    row["id"],
                ),
            )
            self._conn.commit()
            return self._row(row["id"])

    def _fetch_proxyfb_endpoint(
        self, api_key: str, location_id: str, *, force_change: bool = False
    ) -> dict:
        """Get the current endpoint, changing the IP only when requested/needed.

        A forced change is strict. Falling back to ``getProxy`` after a failed
        ``changeProxy`` call would silently keep an expired IP, which is the
        exact failure mode this manager must prevent before a profile/render
        starts.
        """
        if force_change:
            return self._proxyfb_api_request(
                api_key, "changeProxy", location_id=location_id
            )
        try:
            endpoint = self._proxyfb_api_request(api_key, "getProxy")
        except ProxyFBError:
            return self._proxyfb_api_request(
                api_key, "changeProxy", location_id=location_id
            )
        timeout_at = float(endpoint.get("timeout_at") or 0)
        if timeout_at and timeout_at <= time.time() + PROXYFB_REFRESH_MARGIN_SEC:
            if float(endpoint.get("next_change_at") or 0) <= time.time():
                return self._proxyfb_api_request(
                    api_key, "changeProxy", location_id=location_id
                )
            raise ProxyFBError(
                "ProxyFB endpoint sắp/hết hạn nhưng key chưa tới thời điểm được đổi IP."
            )
        return endpoint

    @staticmethod
    def _proxyfb_rotation_due(row, now: float | None = None) -> bool:
        """Return whether an endpoint should rotate under ProxyFB's lease.

        ``next_change`` is the provider's not-before time. A healthy endpoint
        rotates shortly before its reported timeout, once that gate has
        opened. An endpoint flagged unhealthy rotates as soon as the same gate
        permits it. Timeoutless VIP leases have no automatic expiry trigger.
        """
        current_time = time.time() if now is None else float(now)
        retry_at = _seconds(
            row["proxy_retry_at"]
            if "proxy_retry_at" in row.keys()
            else 0
        )
        if retry_at and current_time < retry_at:
            return False
        next_change_at = _seconds(
            row["proxy_next_change_at"]
            if "proxy_next_change_at" in row.keys()
            else 0
        )
        if next_change_at > current_time:
            return False
        timeout_at = _seconds(
            row["proxy_timeout_at"]
            if "proxy_timeout_at" in row.keys()
            else 0
        )
        timeout_due = bool(
            timeout_at
            and timeout_at <= current_time + PROXYFB_REFRESH_MARGIN_SEC
        )
        unhealthy = str(row["status"] or "").lower() == "error"
        return bool(timeout_due or unhealthy)

    @staticmethod
    def _proxyfb_lease_expires_at(row) -> float:
        """Return ProxyFB's lease deadline, or zero for timeoutless keys."""
        return _seconds(row["proxy_timeout_at"])

    def _record_proxyfb_rotation_error(
        self,
        proxy_id: str,
        message: str,
        *,
        retry_sec: float | None = None,
    ):
        """Expose a failed check/rotation and schedule its next safe attempt."""
        retry_delay = (
            config.PROXYFB_ERROR_RETRY_SEC
            if retry_sec is None
            else max(1.0, float(retry_sec))
        )
        retry_at = time.time() + retry_delay
        with _DB_LOCK:
            self._conn.execute(
                "UPDATE proxy_profiles SET status='error', last_error=?, "
                "proxy_retry_at=?, updated_at=? WHERE id=?",
                (
                    str(message or "ProxyFB không đổi được IP")[:240],
                    retry_at,
                    time.time(),
                    str(proxy_id),
                ),
            )
            self._conn.commit()

    def _ensure_proxyfb_current(self, proxy_id: str, *, force_change: bool = False):
        """Refresh an endpoint when its provider lease is due and changeable."""
        lock = self._proxyfb_lock(proxy_id)
        with lock:
            with _DB_LOCK:
                row = self._row(proxy_id)
            if not row or str(row["source"] or "manual") != "proxyfb":
                return row
            now = time.time()
            retry_at = _seconds(
                row["proxy_retry_at"]
                if "proxy_retry_at" in row.keys()
                else 0
            )
            # A failed health check already records a bounded retry window.
            # Do not issue another network check for every waiting video task
            # during that window: it makes the scheduler repeatedly serialize
            # on the same dead endpoint and starves healthy profiles.
            if (
                not force_change
                and str(row["status"] or "").lower() == "error"
                and retry_at > now
            ):
                retry_in = max(1, int(retry_at - now))
                cached_error = str(
                    row["last_error"] or "ProxyFB endpoint chưa xác nhận hoạt động."
                ).strip()
                raise ProxyFBError(
                    f"ProxyFB đang backoff thêm khoảng {retry_in}s sau lỗi trước: "
                    f"{cached_error[:180]}"
                )
            next_change_at = _seconds(row["proxy_next_change_at"])
            timeout_at = _seconds(row["proxy_timeout_at"])
            if (
                not force_change
                and timeout_at
                and timeout_at <= now
                and next_change_at > now
            ):
                wait_for_change = max(1.0, next_change_at - now)
                message = (
                    "ProxyFB lease đã hết hạn; còn khoảng "
                    f"{int(wait_for_change)}s mới tới next_change, không dùng lại IP cũ."
                )
                self._record_proxyfb_rotation_error(
                    proxy_id, message, retry_sec=wait_for_change
                )
                raise ProxyLeaseExpiringError(message)
            rotation_due = self._proxyfb_rotation_due(row, now)
            if not rotation_due and not force_change:
                try:
                    self._wait_and_check_proxyfb_endpoint(row)
                except Exception as exc:
                    # The health check used by profile dispatch also feeds
                    # the background rotator. Give it one short scan interval
                    # to wait for active renders to release this shared key,
                    # instead of holding a failed endpoint for the full API
                    # error backoff window.
                    self._record_proxyfb_rotation_error(
                        proxy_id,
                        str(exc),
                        retry_sec=config.PROXYFB_ROTATION_CHECK_INTERVAL_SEC,
                    )
                    raise
                # A previous background check may have marked the lease as
                # ``error`` even though the endpoint is still usable.  Once
                # the just-in-time check succeeds, clear that stale state so
                # the profile row and the next render both see a verified
                # endpoint.
                if str(row["status"] or "") != "healthy":
                    return self._mark_proxyfb_ip_verified(row["id"])
                return row
            key = self._proxyfb_key_from_row(row)
            location = _normalize_proxyfb_location(row["location_id"])
            endpoint = self._fetch_proxyfb_endpoint(
                key, location, force_change=True
            )
            changed_at = time.time()
            previous_endpoint = (
                str(row["host"] or "").lower(), int(row["port"] or 0)
            )
            next_endpoint = (
                str(endpoint.get("host") or "").lower(),
                int(endpoint.get("port") or 0),
            )
            if previous_endpoint == next_endpoint and all(previous_endpoint):
                raise ProxyFBError(
                    "ProxyFB không trả về IP mới; chưa mở profile/render để tránh dùng lại IP cũ."
                )
            candidate = {
                **dict(row),
                "host": endpoint["host"],
                "port": endpoint["port"],
                "location_id": endpoint.get("location_id") or location,
                "proxy_next_change_at": float(endpoint.get("next_change_at") or 0),
                "proxy_timeout_at": float(endpoint.get("timeout_at") or 0),
                "proxy_last_rotated_at": changed_at,
                "status": "unknown",
                "last_checked_at": 0,
            }
            try:
                self._wait_and_check_proxyfb_endpoint(
                    candidate, changed_at=changed_at, force_check=True
                )
            except Exception as exc:
                self._record_proxyfb_rotation_error(proxy_id, str(exc))
                raise
            saved = self._save_proxyfb_endpoint(
                row,
                endpoint,
                requested_location=location,
                rotated_at=changed_at,
            )
            return self._mark_proxyfb_ip_verified(saved["id"])

    def create_proxyfb(
        self,
        *,
        name: str,
        api_key: str,
        location_id: str = "",
        force_change: bool = True,
    ) -> tuple[str, dict]:
        """Create/update a managed profile backed by one ProxyFB API key."""
        key = _normalize_proxyfb_key(api_key)
        location = _normalize_proxyfb_location(location_id)
        endpoint = self._fetch_proxyfb_endpoint(key, location, force_change=force_change)
        location = endpoint.get("location_id") or location
        fingerprint = self._proxyfb_fingerprint(key)
        now = time.time()
        encrypted_key = self._encrypt(key)
        normalized_name = _clean_text(name, 80) or "ProxyFB rotating"
        with _DB_LOCK:
            existing = self._conn.execute(
                "SELECT * FROM proxy_profiles WHERE source='proxyfb' "
                "AND source_key_fingerprint=? AND location_id=? "
                "ORDER BY updated_at DESC LIMIT 1",
                (fingerprint, location),
            ).fetchone()
            if existing:
                item_id = existing["id"]
                self._conn.execute(
                    "UPDATE proxy_profiles SET name=?, protocol='HTTP', mode='rotating', "
                    "host=?, port=?, username='', password_encrypted='', source='proxyfb', "
                    "source_key_encrypted=?, source_key_fingerprint=?, location_id=?, "
                    "proxy_next_change_at=?, proxy_timeout_at=?, proxy_last_rotated_at=?, proxy_retry_at=0, "
                    "enabled=1, status='unknown', last_checked_at=0, last_error='', updated_at=? "
                    "WHERE id=?",
                    (
                        normalized_name,
                        endpoint["host"],
                        endpoint["port"],
                        encrypted_key,
                        fingerprint,
                        location,
                        float(endpoint.get("next_change_at") or 0),
                        float(endpoint.get("timeout_at") or 0),
                        now,
                        now,
                        item_id,
                    ),
                )
                action = "updated"
            else:
                item_id = f"proxyfb_{uuid.uuid4().hex[:16]}"
                self._conn.execute(
                    "INSERT INTO proxy_profiles "
                    "(id,name,protocol,mode,host,port,username,password_encrypted,source," 
                    "source_key_encrypted,source_key_fingerprint,location_id,proxy_next_change_at," 
                    "proxy_timeout_at,proxy_last_rotated_at,enabled,status,last_checked_at,last_error," 
                    "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'unknown',0,'',?,?)",
                    (
                        item_id,
                        normalized_name,
                        "HTTP",
                        "rotating",
                        endpoint["host"],
                        endpoint["port"],
                        "",
                        "",
                        "proxyfb",
                        encrypted_key,
                        fingerprint,
                        location,
                        float(endpoint.get("next_change_at") or 0),
                        float(endpoint.get("timeout_at") or 0),
                        now,
                        now,
                        now,
                    ),
                )
                action = "created"
            self._conn.commit()
            return action, self._public_row(self._row(item_id))

    async def bulk_create_proxyfb(
        self, text: str, *, default_location: str = "", name_prefix: str = "ProxyFB"
    ) -> dict:
        entries, errors = parse_bulk_proxyfb_text(
            text, default_location=default_location, max_lines=MAX_PROXYFB_LINES
        )
        created: list[dict] = []
        updated: list[dict] = []
        prefix = _clean_text(name_prefix, 40) or "ProxyFB"
        for index, (line_number, key, location) in enumerate(entries, 1):
            try:
                action, item = await asyncio.to_thread(
                    self.create_proxyfb,
                    name=f"{prefix} {index}",
                    api_key=key,
                    location_id=location,
                    force_change=True,
                )
                (created if action == "created" else updated).append(item)
            except Exception as exc:
                errors.append({"line": line_number, "message": str(exc)[:240]})
        return {
            "created": created,
            "updated": updated,
            "errors": errors,
            "summary": {
                "created": len(created),
                "updated": len(updated),
                "errors": len(errors),
            },
        }

    def rotate_proxyfb(self, proxy_id: str) -> dict:
        row = self._ensure_proxyfb_current(proxy_id, force_change=True)
        if not row or str(row["source"] or "manual") != "proxyfb":
            raise ProxyValidationError("Proxy này không phải profile ProxyFB API.")
        return self._public_row(row)

    def _rotate_proxyfb_one(self, row) -> dict:
        """Rotate and verify one row, keeping its full 120s budget local."""
        proxy_id = str(row["id"])
        lock = self._proxyfb_lock(proxy_id)
        with lock:
            try:
                with _DB_LOCK:
                    current = self._row(proxy_id)
                if not current or str(current["source"] or "manual") != "proxyfb":
                    raise ProxyFBError("Proxy không còn là profile ProxyFB API.")
                key = self._proxyfb_key_from_row(current)
                location = _normalize_proxyfb_location(current["location_id"])
                endpoint = self._fetch_proxyfb_endpoint(
                    key, location, force_change=True
                )
                changed_at = time.time()
                previous_endpoint = (
                    str(current["host"] or "").lower(), int(current["port"] or 0)
                )
                next_endpoint = (
                    str(endpoint.get("host") or "").lower(),
                    int(endpoint.get("port") or 0),
                )
                if previous_endpoint == next_endpoint and all(previous_endpoint):
                    raise ProxyFBError(
                        "ProxyFB không trả về IP mới; bỏ qua endpoint cũ."
                    )
                candidate = {
                    **dict(current),
                    "host": endpoint["host"],
                    "port": endpoint["port"],
                    "location_id": endpoint.get("location_id") or location,
                    "proxy_next_change_at": float(endpoint.get("next_change_at") or 0),
                    "proxy_timeout_at": float(endpoint.get("timeout_at") or 0),
                    "proxy_last_rotated_at": changed_at,
                    "status": "unknown",
                    "last_checked_at": 0,
                }
                # Do not save or expose the candidate until ProxyFB's own
                # checker accepts it. The poll schedule is 60, 70, ... 120s.
                self._wait_and_check_proxyfb_endpoint(
                    candidate, changed_at=changed_at, force_check=True
                )
                saved = self._save_proxyfb_endpoint(
                    current,
                    endpoint,
                    requested_location=location,
                    rotated_at=changed_at,
                )
                verified = self._mark_proxyfb_ip_verified(saved["id"])
                return {"rotated": self._public_row(verified)}
            except Exception as exc:
                message = str(exc).strip() or exc.__class__.__name__
                self._record_proxyfb_rotation_error(proxy_id, message)
                return {
                    "failed": {
                        "proxy_id": proxy_id,
                        "name": row["name"],
                        "error": message[:240],
                    }
                }

    def rotate_proxyfb_many(
        self, proxy_ids: list[str] | None = None, *, all_enabled: bool = False
    ) -> dict:
        """Request a fresh endpoint for selected or all enabled ProxyFB rows.

        Each key gets the same change/check/poll flow as the single-proxy
        endpoint. Rows run in parallel, so a batch has the same maximum
        120-second wall-clock budget instead of adding one wait per proxy.
        """
        requested_ids = list(
            dict.fromkeys(
                str(value).strip()
                for value in (proxy_ids or [])
                if str(value).strip()
            )
        )
        skipped = []
        if all_enabled:
            with _DB_LOCK:
                rows = self._conn.execute(
                    "SELECT * FROM proxy_profiles "
                    "WHERE enabled=1 AND source='proxyfb' "
                    "ORDER BY name COLLATE NOCASE, id"
                ).fetchall()
            target_count = len(rows)
        else:
            if not requested_ids:
                raise ProxyValidationError("Hãy chọn ít nhất một ProxyFB để đổi IP.")
            rows = []
            with _DB_LOCK:
                for proxy_id in requested_ids:
                    row = self._row(proxy_id)
                    if row is None:
                        skipped.append({
                            "proxy_id": proxy_id,
                            "name": proxy_id,
                            "error": "Không tìm thấy proxy profile.",
                        })
                    else:
                        rows.append(row)
            target_count = len(requested_ids)

        eligible = []
        for row in rows:
            proxy_id = str(row["id"])
            if not row["enabled"]:
                skipped.append({
                    "proxy_id": proxy_id,
                    "name": row["name"],
                    "error": "Proxy đang tắt.",
                })
                continue
            if str(row["source"] or "manual") != "proxyfb":
                skipped.append({
                    "proxy_id": proxy_id,
                    "name": row["name"],
                    "error": "Chỉ ProxyFB API mới hỗ trợ đổi IP hàng loạt.",
                })
                continue
            eligible.append(row)

        rotated = []
        failed = []
        if eligible:
            # 15 is the current ProxyFB pool size and keeps a bulk request's
            # wall-clock timeout equal to one individual rotation.
            with ThreadPoolExecutor(max_workers=min(15, len(eligible))) as executor:
                futures = {
                    executor.submit(self._rotate_proxyfb_one, row): row
                    for row in eligible
                }
                for future, row in [(future, futures[future]) for future in as_completed(futures)]:
                    try:
                        result = future.result()
                    except Exception as exc:
                        message = str(exc).strip() or exc.__class__.__name__
                        result = {
                            "failed": {
                                "proxy_id": row["id"],
                                "name": row["name"],
                                "error": message[:240],
                            }
                        }
                    if result.get("rotated"):
                        rotated.append(result["rotated"])
                    elif result.get("failed"):
                        failed.append(result["failed"])

        return {
            "requested": target_count,
            "rotated": rotated,
            "skipped": skipped,
            "failed": failed,
            "summary": {
                "requested": target_count,
                "rotated": len(rotated),
                "skipped": len(skipped),
                "failed": len(failed),
            },
        }

    def rotate_due_proxyfb(
        self, active_proxy_ids: set[str] | None = None
    ) -> dict:
        """Rotate timed-out or unhealthy ProxyFB endpoints when change is allowed.

        This is called by the Gateway background scheduler. Rotation is
        serialized per key, so profiles sharing one ProxyFB key observe the
        same fresh endpoint without issuing duplicate change requests. Defer a
        key while a browser render is using it: rotating its leased endpoint
        invalidates the proxy already configured in Chromium and breaks Dola
        polling until that browser context is reopened. ProxyFB's ``next_change``
        is the not-before gate; ``timeout`` supplies the lease deadline.
        Failed change requests still honor their retry time.
        """
        active_ids = {
            str(proxy_id).strip()
            for proxy_id in (active_proxy_ids or ())
            if str(proxy_id).strip()
        }
        with _DB_LOCK:
            rows = self._conn.execute(
                "SELECT * FROM proxy_profiles "
                "WHERE enabled=1 AND source='proxyfb' "
                "ORDER BY name COLLATE NOCASE, id"
            ).fetchall()
        rotated = []
        skipped = []
        deferred = []
        failed = []
        now = time.time()
        due_ids = []
        for row in rows:
            retry_at = _seconds(row["proxy_retry_at"])
            timeout_at = _seconds(row["proxy_timeout_at"])
            next_change_at = _seconds(row["proxy_next_change_at"])
            if timeout_at and timeout_at <= now and next_change_at > now:
                if retry_at <= now:
                    wait_for_change = max(1.0, next_change_at - now)
                    message = (
                        "ProxyFB lease đã hết hạn; còn khoảng "
                        f"{int(wait_for_change)}s mới tới next_change."
                    )
                    self._record_proxyfb_rotation_error(
                        row["id"], message, retry_sec=wait_for_change
                    )
                    failed.append({
                        "proxy_id": row["id"],
                        "name": row["name"],
                        "error": message,
                    })
                else:
                    skipped.append(row["id"])
                continue
            if not self._proxyfb_rotation_due(row, now):
                skipped.append(row["id"])
                continue
            if str(row["id"]) in active_ids:
                deferred.append({"proxy_id": row["id"], "name": row["name"]})
                continue
            due_ids.append(row["id"])
        if due_ids:
            batch = self.rotate_proxyfb_many(due_ids)
            rotated.extend(batch["rotated"])
            failed.extend(batch["failed"])
            skipped.extend(item["proxy_id"] for item in batch["skipped"])
        return {
            "checked": len(rows),
            "rotated": rotated,
            "skipped": skipped,
            "deferred": deferred,
            "failed": failed,
        }

    def create_or_update(self, fields: dict, password: str | None = None, proxy_id: str | None = None) -> dict:
        return self._upsert(fields, password=password, proxy_id=proxy_id)[1]

    def rename(self, proxy_id: str, name: str) -> dict:
        """Rename a managed proxy without changing its endpoint or secrets."""
        raw_name = str(name or "").strip()
        if not raw_name:
            raise ProxyValidationError("Tên profile proxy không được để trống.")
        if len(raw_name) > 80:
            raise ProxyValidationError("Tên profile proxy tối đa 80 ký tự.")
        with _DB_LOCK:
            row = self._row(proxy_id)
            if not row:
                raise KeyError("Không tìm thấy proxy profile.")
            now = time.time()
            self._conn.execute(
                "UPDATE proxy_profiles SET name=?, updated_at=? WHERE id=?",
                (raw_name, now, str(proxy_id)),
            )
            self._conn.commit()
            return self._public_row(self._row(proxy_id))

    def delete(self, proxy_id: str) -> bool:
        with _DB_LOCK:
            row = self._row(proxy_id)
            if not row:
                return False
            self._conn.execute("UPDATE accounts_meta SET proxy_id='', proxy_updated_at=? WHERE proxy_id=?", (time.time(), proxy_id))
            self._conn.execute("DELETE FROM proxy_profiles WHERE id=?", (proxy_id,))
            self._conn.commit()
            return True

    def delete_many(self, proxy_ids: list[str]) -> int:
        deleted = 0
        for proxy_id in dict.fromkeys(str(item).strip() for item in proxy_ids if str(item).strip()):
            deleted += int(self.delete(proxy_id))
        return deleted

    def assign(self, account: str, proxy_id: str | None) -> dict:
        account_name = _clean_text(account, 255)
        if not account_name:
            raise ProxyValidationError("Tên profile không được để trống.")
        with _DB_LOCK:
            if proxy_id:
                row = self._row(proxy_id)
                if not row:
                    raise KeyError("Không tìm thấy proxy profile.")
                if not row["enabled"]:
                    raise ProxyValidationError("Proxy đang tắt, hãy bật lại trước khi gán cho profile.")
            cursor = self._conn.execute(
                "UPDATE accounts_meta SET proxy_id=?, proxy_updated_at=? WHERE name=?",
                (str(proxy_id or ""), time.time(), account_name),
            )
            if cursor.rowcount == 0:
                raise KeyError("Không tìm thấy profile.")
            self._conn.commit()
        return self.account_public(account_name)

    def assign_evenly(self, accounts: list[str], proxy_ids: list[str] | None = None) -> dict:
        """Distribute the selected enabled proxies in round-robin order.

        The caller controls the account and proxy order.  When no proxy IDs
        are supplied, prefer all enabled ProxyFB profiles and fall back to all
        enabled managed proxies.  Profile ``n`` receives proxy
        ``n % proxy_count`` so adjacent profiles use different proxies until
        the proxy list is exhausted, then the sequence starts again.
        """
        names = list(dict.fromkeys(_clean_text(name, 255) for name in (accounts or []) if _clean_text(name, 255)))
        if not names:
            raise ProxyValidationError("Hãy chọn ít nhất một profile để chia proxy.")
        requested_ids = list(dict.fromkeys(str(value).strip() for value in (proxy_ids or []) if str(value).strip()))
        with _DB_LOCK:
            if requested_ids:
                proxy_rows = []
                for proxy_id in requested_ids:
                    row = self._row(proxy_id)
                    if not row:
                        raise KeyError(f"Không tìm thấy proxy profile: {proxy_id}.")
                    proxy_rows.append(row)
            else:
                proxy_rows = self._conn.execute(
                    "SELECT * FROM proxy_profiles WHERE enabled=1 AND source='proxyfb' "
                    "ORDER BY name COLLATE NOCASE, id"
                ).fetchall()
                if not proxy_rows:
                    proxy_rows = self._conn.execute(
                        "SELECT * FROM proxy_profiles WHERE enabled=1 "
                        "ORDER BY name COLLATE NOCASE, id"
                    ).fetchall()
            if not proxy_rows:
                raise ProxyValidationError("Chưa có proxy đang bật để chia cho profile.")
            disabled = [str(row["name"] or row["id"]) for row in proxy_rows if not row["enabled"]]
            if disabled:
                raise ProxyValidationError("Proxy đang tắt: " + ", ".join(disabled[:5]) + ("..." if len(disabled) > 5 else ""))
            existing = set()
            # Stay below SQLite's conservative 999 bind-variable limit so
            # evenly distributing any number of profiles does not fail while
            # validating the requested names.
            for start in range(0, len(names), 500):
                chunk = names[start:start + 500]
                placeholders = ",".join("?" for _ in chunk)
                existing.update(
                    str(row["name"])
                    for row in self._conn.execute(
                        f"SELECT name FROM accounts_meta WHERE name IN ({placeholders})",
                        chunk,
                    ).fetchall()
                )
            missing = [name for name in names if name not in existing]
            if missing:
                raise KeyError("Không tìm thấy profile: " + ", ".join(missing[:5]) + ("..." if len(missing) > 5 else ""))

            proxy_count = len(proxy_rows)
            assignments = []
            distribution = [
                {"proxy_id": row["id"], "proxy_name": row["name"], "count": 0}
                for row in proxy_rows
            ]
            now = time.time()
            for index, name in enumerate(names):
                proxy_index = index % proxy_count
                row = proxy_rows[proxy_index]
                self._conn.execute(
                    "UPDATE accounts_meta SET proxy_id=?, proxy_updated_at=? WHERE name=?",
                    (row["id"], now, name),
                )
                assignments.append({
                    "account": name,
                    "proxy_id": row["id"],
                    "proxy_name": row["name"],
                })
                distribution[proxy_index]["count"] += 1
            self._conn.commit()
        return {
            "ok": True,
            "accounts": len(names),
            "proxies": len(proxy_rows),
            "updated": len(assignments),
            "distribution": distribution,
            "assignments": assignments,
        }

    def account_public(self, account: str) -> dict:
        with _DB_LOCK:
            row = self._conn.execute(
                "SELECT proxy_id FROM accounts_meta WHERE name=?", (str(account),)
            ).fetchone()
            proxy_id = str(row["proxy_id"] or "") if row else ""
            proxy = self._row(proxy_id) if proxy_id else None
            if not proxy:
                return {
                    "proxy_id": None,
                    "proxy_name": "Global mặc định",
                    "proxy_mode": "global",
                    "proxy_status": "default",
                    "proxy_endpoint": "",
                }
            return {
                "proxy_id": proxy["id"],
                "proxy_name": proxy["name"],
                "proxy_mode": proxy["mode"],
                "proxy_status": proxy["status"] or "unknown",
                "proxy_endpoint": _proxy_url(dict(proxy)),
            }

    def proxy_for_account(
        self, account: str, *, minimum_remaining_sec: float = 0
    ) -> dict | None:
        """Return Playwright's proxy dictionary, including the secret locally.

        ``minimum_remaining_sec`` is used by a new video submission as a
        startup safety window. It is checked before and after the normal
        just-in-time refresh, so an endpoint whose known lease is about to
        expire is never handed to a new Chromium context.
        """
        try:
            minimum_remaining = max(0.0, float(minimum_remaining_sec or 0))
        except (TypeError, ValueError):
            minimum_remaining = 0.0
        with _DB_LOCK:
            row = self._conn.execute(
                "SELECT p.* FROM accounts_meta a JOIN proxy_profiles p ON p.id=a.proxy_id "
                "WHERE a.name=? AND p.enabled=1", (str(account),)
            ).fetchone()
            if not row:
                return None
            # A live lease below the startup window must not be handed to the
            # browser, even when ProxyFB has not allowed the next change yet.
            # Expired leases are handled by the normal refresh path below;
            # only a still-live but too-short lease is intentionally skipped.
            if minimum_remaining and str(row["source"] or "manual") == "proxyfb":
                expires_at = self._proxyfb_lease_expires_at(row)
                remaining = expires_at - time.time() if expires_at else 0.0
                if 0 < remaining < minimum_remaining:
                    raise ProxyLeaseExpiringError(
                        f"Proxy {row['name']} của profile {account} chỉ còn "
                        f"{max(0, int(remaining))}s lease "
                        f"(< {int(minimum_remaining)}s); bỏ qua profile trước khi mở Dola."
                    )
        # ProxyFB returns a leased IP:port rather than a permanent gateway.
        # Refresh when the provider timeout is due and next_change permits it,
        # or when a failed endpoint becomes changeable. A running browser keeps
        # the endpoint it started with until its profile is reopened.
        if str(row["source"] or "manual") == "proxyfb":
            row = self._ensure_proxyfb_current(row["id"])
            if row is None:
                return None
            if not row["enabled"]:
                return None
        with _DB_LOCK:
            if minimum_remaining and str(row["source"] or "manual") == "proxyfb":
                expires_at = self._proxyfb_lease_expires_at(row)
                if expires_at:
                    remaining = expires_at - time.time()
                    if remaining < minimum_remaining:
                        raise ProxyLeaseExpiringError(
                            f"Proxy {row['name']} của profile {account} chỉ còn "
                            f"{max(0, int(remaining))}s lease "
                            f"(< {int(minimum_remaining)}s); bỏ qua profile trước khi mở Dola."
                        )
            password = self._password_from_row(row)
            result = {
                "server": _proxy_url(dict(row)),
                "proxy_id": row["id"],
                "proxy_name": row["name"],
                "proxy_mode": row["mode"],
            }
            # Playwright handles credentials more reliably when they are
            # separate fields, especially for rotating providers.
            if row["username"]:
                result["username"] = row["username"]
                result["password"] = password
                result["server"] = _proxy_url({**dict(row), "username": ""})
            return result

    @staticmethod
    def _checker_error(row, message: str) -> dict:
        message_text = str(message or "").strip()
        if not message_text:
            message_text = "Proxy Checker không phản hồi hoặc không trả về lỗi cụ thể."
        return {
            "proxy_id": row["id"],
            "ok": False,
            "status": "error",
            "message": message_text[:240],
        }

    async def _test_batch(self, rows: list, timeout: float) -> list[dict]:
        """Check a group of rows with one multipart request to ProxyFB."""
        if not rows:
            return []
        prepared = []
        results: dict[str, dict] = {}
        checker_type = "SOCKS5" if rows[0]["protocol"] == "SOCKS5" else "HTTP"
        for row in rows:
            try:
                password = self._password_from_row(row)
                prepared.append((row, _checker_line(dict(row), password)))
            except Exception as exc:
                results[row["id"]] = self._checker_error(row, str(exc))
        if prepared:
            try:
                timeout_config = aiohttp.ClientTimeout(total=max(2.0, float(timeout)))
                form = aiohttp.FormData()
                form.add_field("proxies", "\n".join(line for _, line in prepared))
                form.add_field("type", checker_type)
                async with aiohttp.ClientSession(timeout=timeout_config) as session:
                    async with session.post(PROXY_CHECK_URL, data=form) as response:
                        if response.status >= 400:
                            message = f"Proxy Checker trả về HTTP {response.status}."
                            for row, _ in prepared:
                                results[row["id"]] = self._checker_error(row, message)
                        else:
                            payload = json.loads(await response.text())
                            raw_results = payload.get("results") if isinstance(payload, dict) else None
                            if not isinstance(raw_results, list):
                                raise RuntimeError("Proxy Checker trả về dữ liệu không hợp lệ.")
                            for index, (row, _) in enumerate(prepared):
                                item = raw_results[index] if index < len(raw_results) else None
                                if not isinstance(item, dict):
                                    results[row["id"]] = self._checker_error(
                                        row, "Proxy Checker thiếu kết quả cho proxy này."
                                    )
                                    continue
                                ok = str(item.get("status") or "").upper() == "OK"
                                results[row["id"]] = {
                                    "proxy_id": row["id"],
                                    "ok": ok,
                                    "status": "healthy" if ok else "error",
                                    "message": "Proxy Checker xác nhận proxy hoạt động."
                                    if ok else "Proxy Checker xác nhận proxy không hoạt động.",
                                }
            except asyncio.TimeoutError:
                message = "Proxy Checker hết thời gian phản hồi."
                for row, _ in prepared:
                    results[row["id"]] = self._checker_error(row, message)
            except aiohttp.ClientError as exc:
                message = str(exc).strip() or "Không thể kết nối Proxy Checker."
                for row, _ in prepared:
                    results[row["id"]] = self._checker_error(row, message)
            except Exception as exc:
                message = str(exc).strip() or "Proxy Checker không trả về dữ liệu hợp lệ."
                for row, _ in prepared:
                    results[row["id"]] = self._checker_error(row, message)
        return [results.get(row["id"], self._checker_error(row, "Không có kết quả kiểm tra.")) for row in rows]

    async def _test_row(self, row, target_url: str, timeout: float) -> dict:
        """Compatibility wrapper for callers that check one row directly."""
        result = await self._test_batch([row], timeout)
        return result[0]

    async def test_many(self, proxy_ids: list[str] | None = None, *, all_enabled: bool = False,
                        target_url: str = DEFAULT_TEST_URL, timeout: float = 8.0) -> dict:
        with _DB_LOCK:
            if all_enabled:
                rows = self._conn.execute("SELECT * FROM proxy_profiles WHERE enabled=1 ORDER BY name COLLATE NOCASE").fetchall()
            else:
                ids = list(dict.fromkeys(str(value).strip() for value in (proxy_ids or []) if str(value).strip()))
                rows = []
                for proxy_id in ids:
                    row = self._row(proxy_id)
                    if row:
                        rows.append(row)
        if not rows:
            raise ProxyValidationError("Chưa chọn proxy để kiểm tra.")
        if len(rows) > MAX_TEST_ITEMS:
            raise ProxyValidationError(f"Mỗi lần chỉ được kiểm tra tối đa {MAX_TEST_ITEMS} proxy.")
        # The checker accepts a newline-separated list. Keep HTTP/HTTPS and
        # SOCKS5 in separate batches because its ``type`` field is global to
        # one request, then restore the original profile order for the UI.
        groups = {
            "HTTP": [row for row in rows if row["protocol"] != "SOCKS5"],
            "SOCKS5": [row for row in rows if row["protocol"] == "SOCKS5"],
        }
        grouped_results = await asyncio.gather(
            *(self._test_batch(group, timeout) for group in groups.values() if group)
        )
        by_id = {
            result["proxy_id"]: result
            for group_result in grouped_results
            for result in group_result
        }
        results = [by_id.get(row["id"], self._checker_error(row, "Không có kết quả kiểm tra.")) for row in rows]
        checked_at = time.time()
        with _DB_LOCK:
            for result in results:
                self._conn.execute(
                    "UPDATE proxy_profiles SET status=?, last_checked_at=?, last_error=?, "
                    "proxy_retry_at=CASE WHEN ?='healthy' THEN 0 ELSE proxy_retry_at END, "
                    "updated_at=? WHERE id=?",
                    (
                        result["status"],
                        checked_at,
                        "" if result["ok"] else result["message"],
                        result["status"],
                        checked_at,
                        result["proxy_id"],
                    ),
                )
            self._conn.commit()
        return {
            "ok": True,
            "results": results,
            "summary": {
                "total": len(results),
                "healthy": sum(1 for result in results if result["ok"]),
                "failed": sum(1 for result in results if not result["ok"]),
            },
        }
