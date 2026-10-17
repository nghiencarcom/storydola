"""Encrypted, server-side credentials for reusable account relogin flows.

The dashboard never receives the stored password or TOTP secret.  The
credentials are encrypted with a Fernet key kept outside the JSON vault.  For
local development the key is generated once with restrictive file
permissions; production deployments can provide DOLA_CREDENTIALS_KEY through
their secret manager instead.
"""

import json
import os
import threading
import uuid
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

import config


class CredentialStoreError(RuntimeError):
    """Raised when the encrypted account credential vault cannot be used."""


class AccountCredentialStore:
    def __init__(self, path: str | Path | None = None,
                 key_path: str | Path | None = None):
        self.path = Path(path or config.CREDENTIALS_FILE)
        self.key_path = Path(key_path or config.CREDENTIALS_KEY_FILE)
        self._lock = threading.RLock()
        self._fernet = Fernet(self._load_key())

    def _load_key(self) -> bytes:
        configured = str(config.CREDENTIALS_KEY or "").strip()
        if configured:
            key = configured.encode("ascii")
            try:
                Fernet(key)
            except Exception as exc:
                raise CredentialStoreError(
                    "DOLA_CREDENTIALS_KEY không phải Fernet key hợp lệ"
                ) from exc
            return key

        try:
            if self.key_path.exists():
                key = self.key_path.read_bytes().strip()
                Fernet(key)
                self._restrict_permissions(self.key_path)
                return key

            key = Fernet.generate_key()
            self._atomic_write(self.key_path, key)
            return key
        except CredentialStoreError:
            raise
        except Exception as exc:
            raise CredentialStoreError(
                "Không thể khởi tạo key mã hoá thông tin đăng nhập trên Gateway"
            ) from exc

    @staticmethod
    def _restrict_permissions(path: Path) -> None:
        try:
            os.chmod(path, 0o600)
        except OSError:
            # Windows may not support POSIX mode bits; the file is still kept
            # outside the HTTP surface and the caller can use an env key.
            pass

    @classmethod
    def _atomic_write(cls, path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            descriptor = os.open(temporary, flags, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
            except Exception:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                raise
            os.replace(temporary, path)
            cls._restrict_permissions(path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _read_records(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CredentialStoreError(
                "Không đọc được kho thông tin đăng nhập đã mã hoá"
            ) from exc
        if not isinstance(raw, dict):
            raise CredentialStoreError("Kho thông tin đăng nhập có định dạng không hợp lệ")
        return {
            str(name): token
            for name, token in raw.items()
            if isinstance(name, str) and isinstance(token, str) and token
        }

    def _write_records(self, records: dict[str, str]) -> None:
        payload = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self._atomic_write(self.path, payload.encode("utf-8"))

    def save(self, name: str, email: str, password: str, totp: str = "") -> None:
        profile = str(name or "").strip()
        address = str(email or "").strip()
        secret = str(password or "")
        if not profile or not address or not secret:
            raise CredentialStoreError("Thiếu dữ liệu để lưu thông tin đăng nhập")
        record = {
            "email": address,
            "password": secret,
            "totp": str(totp or "").strip(),
        }
        token = self._fernet.encrypt(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).decode("ascii")
        with self._lock:
            records = self._read_records()
            records[profile] = token
            self._write_records(records)

    def get(self, name: str) -> dict[str, str] | None:
        profile = str(name or "").strip()
        if not profile:
            return None
        with self._lock:
            token = self._read_records().get(profile)
        if not token:
            return None
        try:
            raw = self._fernet.decrypt(token.encode("ascii"))
            record = json.loads(raw.decode("utf-8"))
        except (InvalidToken, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CredentialStoreError(
                "Không thể giải mã thông tin đăng nhập của profile"
            ) from exc
        if not isinstance(record, dict) or not record.get("email") or not record.get("password"):
            raise CredentialStoreError("Thông tin đăng nhập của profile không hợp lệ")
        return {
            "email": str(record["email"]).strip(),
            "password": str(record["password"]),
            "totp": str(record.get("totp") or "").strip(),
        }

    def has(self, name: str) -> bool:
        return self.get(name) is not None

    def delete(self, name: str) -> None:
        profile = str(name or "").strip()
        if not profile:
            return
        with self._lock:
            records = self._read_records()
            if profile not in records:
                return
            records.pop(profile, None)
            self._write_records(records)
