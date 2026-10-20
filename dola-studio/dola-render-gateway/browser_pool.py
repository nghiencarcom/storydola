"""Browser Account Pool: Manages accounts/ profiles with concurrency control and daily limits."""
import asyncio
import re
import shutil
import sqlite3
import time
import uuid
from datetime import datetime, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

from dola_client import CreditError, ROLLING_VIDEO_LIMIT_PATTERN
from video_worker_ui import (
    AccountLimitedError,
    CreditInsufficientError,
    FreshChatRetryError,
    ImageLikenessRejectedError,
    PostSubmitAccountLimitError,
    PostSubmitCreditError,
    PostSubmitRateLimitError,
    PreSubmitRiskControlError,
    PreSubmitAttachmentSetupError,
    PreSubmitPromptSetupError,
    PreSubmitSetupError,
    RiskControlError,
    RateLimitError,
    SessionExpiredError,
    VideoValidationError,
    generate_video,
    resume_video,
)
import config
from proxy_manager import ProxyFBError, ProxyLeaseExpiringError, ProxyManager
from profile_identity import google_profile_identity

DAILY_LIMIT = config.INTERNAL_DAILY_LIMIT
COOLDOWN_SEC = config.RISK_CONTROL_COOLDOWN_SEC
PROVIDER_BUSY_COOLDOWN_SEC = 30 * 60
PROVIDER_RATE_LIMIT_COOLDOWN_SEC = config.PROVIDER_RATE_LIMIT_COOLDOWN_SEC
SQLITE_BUSY_TIMEOUT_MS = 30000
GLOBAL_PROXY_USAGE_ID = "__global__"


def _run_login_state_check_in_worker(
    account: str,
    profile_dir: str | Path,
    proxy: dict | str | None = None,
    timeout_sec: float | None = None,
) -> dict:
    """Run Patchright's async login probe on an isolated event loop.

    Automated risk recovery and dashboard verification are auxiliary work.
    Running their browser protocol on the Gateway's Uvicorn loop lets one
    large Chromium JSON message delay every HTTP endpoint, including
    ``/health``. ``asyncio.run`` is safe here because this function is only
    called through ``asyncio.to_thread``.
    """
    from browser import check_login_state_details

    return asyncio.run(
        check_login_state_details(
            account,
            profile_dir=profile_dir,
            proxy=proxy,
            timeout_sec=timeout_sec,
        )
    )


def _usage_timezone():
    """Return the configured timezone used for daily internal usage."""
    try:
        return ZoneInfo(config.LIMIT_RESET_TZ)
    except Exception:
        # Keep the configured provider defaults usable if the host does not
        # have the IANA timezone database available.
        offsets = {
            "Asia/Ho_Chi_Minh": 7,
            "Asia/Tokyo": 9,
            "Asia/Hong_Kong": 8,
            "UTC": 0,
        }
        return timezone(timedelta(hours=offsets.get(config.LIMIT_RESET_TZ, 7)))


def _usage_day(timestamp: float | None = None) -> str:
    """Return the internal-quota day in the provider reset timezone."""
    tz = _usage_timezone()
    moment = datetime.now(tz) if timestamp is None else datetime.fromtimestamp(timestamp, tz)
    return moment.date().isoformat()


def _usage_day_bounds(timestamp: float | None = None) -> tuple[float, float]:
    """Return the current local day's inclusive start and exclusive end epochs."""
    tz = _usage_timezone()
    moment = datetime.now(tz) if timestamp is None else datetime.fromtimestamp(timestamp, tz)
    start = datetime.combine(moment.date(), dt_time.min, tzinfo=tz)
    end = start + timedelta(days=1)
    return start.timestamp(), end.timestamp()


def _safe_float(value, default: float = 0.0) -> float:
    """Coerce nullable legacy SQLite numeric fields to a usable float."""
    try:
        return float(value) if value is not None else float(default)
    except (TypeError, ValueError):
        return float(default)


def _is_pre_submit_risk_control(error: Exception) -> bool:
    """Return whether a risk response explicitly lacks a durable conversation.

    The UI worker uses ``PreSubmitRiskControlError`` for this state. Keep a
    message-based fallback for older/alternate workers that still raise the
    base ``RiskControlError`` with the stable ``chưa chấp nhận conversation``
    wording; this prevents a profile-local response from becoming a global
    pause when the composer was already filled.
    """
    if isinstance(error, PreSubmitRiskControlError):
        return True
    text = str(error or "").strip().lower()
    return (
        "chưa chấp nhận conversation" in text
        or "before provider acceptance" in text
        or "conversation_id not observed" in text
    )


def _post_submit_rate_limit_error(error: RateLimitError) -> PostSubmitRateLimitError:
    """Preserve task rotation when a legacy worker reports a base rate-limit error."""
    if isinstance(error, PostSubmitRateLimitError):
        return error
    return PostSubmitRateLimitError(
        f"Dola rate-limited after accepting conversation: {str(error)[:300]}"
    )


def _is_pre_submit_browser_closed(error: Exception) -> bool:
    """Recognize a headed profile closing before a conversation was saved.

    A Dola tab can disappear while the composer is waiting for its streamed
    acknowledgement (for example when Chromium or an extension restarts).
    With no durable conversation id this attempt can be retried on another
    profile; once the provider boundary is recorded the caller still raises
    to preserve duplicate-safety.
    """
    text = str(error or "").strip().lower()
    return (
        "target page, context or browser has been closed" in text
        or "target page or browser has been closed" in text
        or "browsercontext.close: connection closed" in text
    )


def _sqlite_is_locked(error: Exception) -> bool:
    message = str(error).lower()
    return "database is locked" in message or "database table is locked" in message


def _configure_sqlite_connection(conn: sqlite3.Connection):
    """Configure a connection shared by the API server and workers.

    The dashboard and render workers can live in different processes. WAL lets
    health/status reads continue while a worker writes, and the busy timeout
    absorbs short hand-offs without turning a transient lock into a failed
    video task.
    """
    conn.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
    for attempt in range(5):
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.commit()
            return
        except sqlite3.OperationalError as exc:
            conn.rollback()
            if not _sqlite_is_locked(exc) or attempt == 4:
                raise
            time.sleep(0.25 * (attempt + 1))


class AllAccountsLimitedError(RuntimeError):
    """All active schedulable accounts have reached daily video limit."""


class AllAccountsQuotaBlockedError(RuntimeError):
    """All active schedulable accounts are known to have insufficient credits."""


class AccountsBusyError(RuntimeError):
    """Eligible profiles exist, but every one is currently processing a task."""


class BrowserPool:
    def __init__(self, accounts_dir: str = "accounts", db_path: str | None = None,
                 max_concurrency: int = 1):
        self.accounts_dir = Path(accounts_dir)
        db_path = db_path or getattr(config, "POOL_DB_PATH", "pool_usage.db")
        self.db_path = str(db_path)
        self.max_concurrency = max(1, int(max_concurrency))
        self.semaphore = asyncio.Semaphore(self.max_concurrency)
        # The global semaphore is the only hard concurrency limit. Proxy
        # assignment is not a capacity constraint; the active-proxy map below
        # is only a soft selection hint after account internal usage.
        self._submission_gate = asyncio.Lock()
        # Serialize the short account/proxy reservation step.  The browser
        # work itself remains concurrent, but a batch that starts together
        # must see the previous reservation before choosing its next profile.
        self._dispatch_selection_lock = asyncio.Lock()
        self._active_proxy_dispatches: dict[str, int] = {}
        self._last_submission_at = 0.0
        self._locks: dict[str, asyncio.Lock] = {}
        # Waiting tasks sleep on this event instead of repeatedly scanning the
        # whole account pool. A release wakes them immediately; the timeout
        # remains a recovery path for external state changes.
        self._availability_event = asyncio.Event()
        # Keep an accepted profile reserved while the server waits for its
        # next poll window. Otherwise a new task could submit on the same
        # persistent Chromium profile between two polls.
        self._polling_accounts: set[str] = set()
        # Risk recovery opens profiles to verify the persisted Dola cookie.
        # Serialize these checks and never compete with a render/open-profile
        # lock for the same account.
        self._risk_recovery_lock = asyncio.Lock()
        # Automatic relogin opens a headed Google/Dola flow. Serialize these
        # flows so concurrent expired profiles do not open several OAuth
        # windows at once.
        self._relogin_lock = asyncio.Lock()
        self._relogin_last_finished = 0.0
        self._conn = sqlite3.connect(
            db_path, timeout=SQLITE_BUSY_TIMEOUT_MS / 1000, check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        _configure_sqlite_connection(self._conn)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS usage (account TEXT, day TEXT, used INTEGER, "
            "PRIMARY KEY(account, day))"
        )
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS usage_claims ("
            "account TEXT NOT NULL, conversation_id TEXT NOT NULL, claimed_at REAL NOT NULL, "
            "PRIMARY KEY(account, conversation_id))"
        )
        # ``conversation_id`` is a legacy column name; new rows store the
        # stable render task key when one is available.
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_usage_claims_account_claimed_at "
            "ON usage_claims(account, claimed_at)"
        )
        # Keep a dispatch counter per managed proxy.  The account counter below
        # is intentionally a successful-video counter, so it cannot guarantee
        # that a newly queued batch uses each proxy before reusing one.  This
        # table counts reservations at dispatch time and survives Gateway
        # restarts.
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS proxy_usage ("
            "proxy_id TEXT NOT NULL, day TEXT NOT NULL, "
            "dispatches INTEGER NOT NULL DEFAULT 0, last_used_at REAL DEFAULT 0, "
            "PRIMARY KEY(proxy_id, day))"
        )
        # A one-time marker lets a new installation use today's existing
        # successful account counts as a fair starting baseline without adding
        # them again after every restart.
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS proxy_usage_seed_days ("
            "day TEXT PRIMARY KEY, seeded_at REAL NOT NULL)"
        )
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
                cooldown_global INTEGER DEFAULT 0
            )
            """
        )
        self._conn.commit()
        # Legacy migration: add metadata columns
        added_credit_disabled = False
        for column, definition in (
            ("email", "TEXT DEFAULT ''"),
            ("cooldown_reason", "TEXT DEFAULT ''"),
            ("cooldown_auto_restore", "INTEGER DEFAULT 0"),
            ("rate_limited_until", "REAL DEFAULT 0"),
            ("limit_reason", "TEXT DEFAULT ''"),
            ("quota_blocked_until", "REAL DEFAULT 0"),
            ("quota_reason", "TEXT DEFAULT ''"),
            ("credit_disabled", "INTEGER DEFAULT 0"),
            ("credit_balance", "INTEGER"),
            ("credit_checked_at", "REAL DEFAULT 0"),
            ("cooldown_global", "INTEGER DEFAULT 0"),
            ("proxy_id", "TEXT DEFAULT ''"),
            ("proxy_updated_at", "REAL DEFAULT 0"),
        ):
            try:
                self._conn.execute(f"ALTER TABLE accounts_meta ADD COLUMN {column} {definition}")
                self._conn.commit()
                if column == "credit_disabled":
                    added_credit_disabled = True
            except sqlite3.OperationalError:
                pass
        # Older pool databases could contain NULL in timestamp columns when
        # those columns were added by a migration without a default.  Keep
        # NULL meaningful only for fields that are explicitly optional (for
        # example login_ok and credit_balance); scheduler timestamps must
        # always be numeric so status reads cannot crash submission.
        self._conn.execute(
            "UPDATE accounts_meta SET "
            "last_used_at=COALESCE(last_used_at, 0), "
            "login_checked_at=COALESCE(login_checked_at, 0), "
            "cooldown_until=COALESCE(cooldown_until, 0), "
            "rate_limited_until=COALESCE(rate_limited_until, 0), "
            "quota_blocked_until=COALESCE(quota_blocked_until, 0), "
            "credit_checked_at=COALESCE(credit_checked_at, 0), "
            "cooldown_reason=COALESCE(cooldown_reason, ''), "
            "limit_reason=COALESCE(limit_reason, ''), "
            "quota_reason=COALESCE(quota_reason, '')"
        )
        self._conn.commit()
        if added_credit_disabled:
            self._conn.execute(
                "UPDATE accounts_meta SET credit_disabled=1, cooldown_auto_restore=0 "
                "WHERE quota_blocked_until > ?", (time.time(),)
            )
            self._conn.commit()
        # Balances vary by model and request cost. Old account-wide credit
        # pauses must not prevent a new Fast/Pro attempt; fresh provider limits
        # are tracked separately by rate_limited_until.
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS pool_migrations ("
            "name TEXT PRIMARY KEY, applied_at REAL NOT NULL)"
        )
        credit_retry_migration = "credit-balance-not-account-lock-v1"
        migration_claimed = self._conn.execute(
            "INSERT OR IGNORE INTO pool_migrations (name, applied_at) VALUES (?,?)",
            (credit_retry_migration, time.time()),
        ).rowcount
        if migration_claimed:
            cleared = self._conn.execute(
                "UPDATE accounts_meta SET quota_blocked_until=0, quota_reason='', "
                "credit_disabled=0 WHERE quota_blocked_until>0 OR credit_disabled<>0"
            ).rowcount
            self._conn.commit()
            if cleared:
                print(
                    f"[pool] cleared {cleared} legacy credit-only profile pauses; "
                    "Dola will confirm each new request",
                    flush=True,
                )
        # Before the reason columns existed, cooldown_until was written only
        # for risk-control responses. Recover the one class of profiles that
        # the old code could strand with scheduling disabled; active profiles
        # need no browser check and can simply age out their old marker.
        try:
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_reason='risk_control', "
                "cooldown_auto_restore=CASE WHEN scheduling=0 THEN 1 ELSE cooldown_auto_restore END "
                "WHERE cooldown_until > 0 AND COALESCE(cooldown_reason, '')=''"
            )
            # Risk-control observations belong to the profile that received
            # them. Clear legacy global markers so one challenged profile
            # cannot keep the whole pool from dispatching after a restart.
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_global=0 "
                "WHERE cooldown_global<>0"
            )
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_auto_restore=1, scheduling=0 "
                "WHERE cooldown_reason='risk_control' AND cooldown_auto_restore=0 "
                "AND scheduling=1 AND cooldown_until > 0 AND cooldown_until <= ?",
                (time.time(),),
            )
            # Historical active profiles already recovered while the old
            # cooldown marker was only informational. Do not open every such
            # profile on Gateway startup; clear those expired markers and keep
            # browser verification for profiles explicitly marked for restore.
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_until=0, cooldown_reason='', "
                "cooldown_auto_restore=0, cooldown_global=0 "
                "WHERE cooldown_reason='risk_control' "
                "AND cooldown_auto_restore=0 AND cooldown_until <= ?",
                (time.time(),),
            )
            self._conn.commit()
        except sqlite3.OperationalError as exc:
            self._conn.rollback()
            if not _sqlite_is_locked(exc):
                raise
        self._seed_proxy_usage_from_account_usage()
        # The registry uses the same SQLite file as account metadata.  It is
        # initialized after the legacy columns above so old installations can
        # upgrade in place without a separate migration command.
        self.proxy_manager = ProxyManager(db_path)

    # ===== Account Discovery & Metadata =====

    def _ensure_meta(self, name: str):
        try:
            self._conn.execute(
                "INSERT OR IGNORE INTO accounts_meta (name, created_at) VALUES (?, ?)",
                (name, time.time()),
            )
            # INSERT OR IGNORE still starts a transaction when the row already
            # exists. Always finish it or health polling can hold the DB lock.
            self._conn.commit()
        except sqlite3.OperationalError as exc:
            self._conn.rollback()
            # Metadata is auxiliary; a concurrent worker must not make the
            # health/admin endpoints fail if this best-effort insert times out.
            if not _sqlite_is_locked(exc):
                raise

    @property
    def accounts(self) -> list:
        if not self.accounts_dir.exists():
            return []
        names = sorted(d.name for d in self.accounts_dir.iterdir()
                       if d.is_dir() and not d.name.startswith("."))
        for n in names:
            self._ensure_meta(n)
        return names

    def _meta(self, name: str):
        return self._conn.execute(
            "SELECT * FROM accounts_meta WHERE name=?", (name,)).fetchone()

    def used_today(self, account: str) -> int:
        """Count successful video claims for this profile in today's reset window."""
        day_start, next_day_start = _usage_day_bounds()
        row = self._conn.execute(
            "SELECT COUNT(*) FROM usage_claims "
            "WHERE account=? AND claimed_at>=? AND claimed_at<?",
            (account, day_start, next_day_start),
        ).fetchone()
        try:
            return max(0, int(row[0] or 0)) if row else 0
        except (TypeError, ValueError):
            return 0

    def _seed_proxy_usage_from_account_usage(self):
        """Backfill today's proxy baseline once when upgrading an old pool.

        Older Gateway versions recorded only successful videos per account.
        Use that data once, grouped by the account's current proxy assignment,
        so the new account-first scheduler starts from the same internal daily
        usage instead of treating every proxy as unused after an upgrade.
        """
        day = _usage_day()
        try:
            seeded = self._conn.execute(
                "SELECT 1 FROM proxy_usage_seed_days WHERE day=?", (day,)
            ).fetchone()
            if seeded:
                return
            rows = self._conn.execute(
                "SELECT COALESCE(NULLIF(a.proxy_id, ''), ?) AS proxy_id, "
                "SUM(u.used) AS dispatches, MAX(a.last_used_at) AS last_used_at "
                "FROM usage u JOIN accounts_meta a ON a.name=u.account "
                "WHERE u.day=? GROUP BY COALESCE(NULLIF(a.proxy_id, ''), ?)",
                (GLOBAL_PROXY_USAGE_ID, day, GLOBAL_PROXY_USAGE_ID),
            ).fetchall()
            for row in rows:
                self._conn.execute(
                    "INSERT OR IGNORE INTO proxy_usage "
                    "(proxy_id, day, dispatches, last_used_at) VALUES (?,?,?,?)",
                    (
                        str(row["proxy_id"] or GLOBAL_PROXY_USAGE_ID),
                        day,
                        int(row["dispatches"] or 0),
                        float(row["last_used_at"] or 0),
                    ),
                )
            self._conn.execute(
                "INSERT OR IGNORE INTO proxy_usage_seed_days(day, seeded_at) VALUES (?,?)",
                (day, time.time()),
            )
            self._conn.commit()
        except sqlite3.OperationalError as exc:
            self._conn.rollback()
            if not _sqlite_is_locked(exc):
                raise

    def _proxy_dispatch_snapshot(self) -> dict[str, dict]:
        """Return today's persisted proxy dispatch counters in one query."""
        day = _usage_day()
        rows = self._conn.execute(
            "SELECT proxy_id, dispatches, last_used_at FROM proxy_usage WHERE day=?",
            (day,),
        ).fetchall()
        return {
            str(row["proxy_id"]): {
                "dispatches": int(row["dispatches"] or 0),
                "last_used_at": float(row["last_used_at"] or 0),
            }
            for row in rows
        }

    def _claim(
        self,
        account: str,
        conversation_id: str | None = None,
        task_id: str | None = None,
    ):
        """Record one successful video, idempotent for the render task."""
        try:
            task_key = str(task_id or "").strip()
            conversation_key = str(conversation_id or "").strip()
            if task_key:
                claim_id = f"task:{task_key}"
            elif conversation_key:
                claim_id = f"conversation:{conversation_key}"
            else:
                claim_id = f"success:{uuid.uuid4().hex}"
            inserted = self._conn.execute(
                "INSERT OR IGNORE INTO usage_claims(account, conversation_id, claimed_at) "
                "VALUES (?,?,?)",
                (account, claim_id, time.time()),
            ).rowcount
            if not inserted:
                # The ignored INSERT is still a DML statement. Roll it
                # back so an idempotent recovery cannot retain a lock.
                self._conn.rollback()
                return
            self._conn.execute(
                "INSERT INTO usage(account, day, used) VALUES (?,?,1) "
                "ON CONFLICT(account, day) DO UPDATE SET used=used+1",
                (account, _usage_day()),
            )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    def _next_limit_reset(self, days: int = 1) -> float:
        """Calculate the next provider limit reset at local midnight."""
        days = max(1, int(days))
        try:
            tz = ZoneInfo(config.LIMIT_RESET_TZ)
        except Exception:
            # Fallback to fixed offset if tzdata is not installed.
            offsets = {
                "Asia/Ho_Chi_Minh": 7,
                "Asia/Tokyo": 9,
                "Asia/Hong_Kong": 8,
                "UTC": 0,
            }
            tz = timezone(timedelta(hours=offsets.get(config.LIMIT_RESET_TZ, 7)))
        now = datetime.now(tz)
        next_day = now.date() + timedelta(days=days)
        return datetime.combine(next_day, dt_time.min, tzinfo=tz).timestamp()

    def _provider_limit_reset_at(self, reason: str = "") -> float | None:
        """Extract Dola's explicit reset timestamp when one is provided.

        Dola's limit copy is localized. Current responses include English
        (``September 24, 2026, 17:05 (GMT+08:00)``) and Japanese/Chinese
        (``2026年9月24日 17:05（GMT+08:00）``), while Vietnamese can use
        ``24 tháng 9 năm 2026 17:05 (GMT+08:00)``. Prefer that authoritative
        provider timestamp over a local-midnight approximation.
        """
        raw = str(reason or "")
        offset_match = re.search(
            r"GMT\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?",
            raw,
            re.IGNORECASE,
        )
        if not offset_match:
            return None
        sign = 1 if offset_match.group(1) == "+" else -1
        offset_minutes = sign * (
            int(offset_match.group(2)) * 60
            + int(offset_match.group(3) or 0)
        )
        tz = timezone(timedelta(minutes=offset_minutes))
        month_names = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12,
        }
        date_parts = []
        english = re.search(
            r"\b(january|february|march|april|may|june|july|august|"
            r"september|october|november|december)\s+(\d{1,2}),\s*"
            r"(\d{4}),\s*(\d{1,2}):(\d{2})",
            raw,
            re.IGNORECASE,
        )
        if english:
            date_parts.append(
                (
                    int(english.group(3)),
                    month_names[english.group(1).lower()],
                    int(english.group(2)),
                    int(english.group(4)),
                    int(english.group(5)),
                )
            )
        localized = re.search(
            r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"
            r"[^\d]{0,24}(\d{1,2}):(\d{2})",
            raw,
        )
        if localized:
            date_parts.append(tuple(map(int, localized.groups())))
        vietnamese = re.search(
            r"(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})"
            r"[^\d]{0,24}(\d{1,2}):(\d{2})",
            raw,
            re.IGNORECASE,
        )
        if vietnamese:
            day, month, year, hour, minute = map(int, vietnamese.groups())
            date_parts.append((year, month, day, hour, minute))
        iso = re.search(
            r"\b(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)"
            r"[^\d]{0,24}(\d{1,2}):(\d{2})",
            raw,
        )
        if iso:
            date_parts.append(tuple(map(int, iso.groups())))
        for year, month, day, hour, minute in date_parts:
            try:
                value = datetime(
                    year, month, day, hour, minute, tzinfo=tz
                ).timestamp()
            except (TypeError, ValueError, OverflowError):
                continue
            if value > time.time():
                return value
        return None

    def _clear_expired_rate_limits(self):
        now = time.time()
        try:
            # A quota block is a temporary provider observation, not a manual
            # scheduling preference. At reset, discard the old balance so the
            # next selected profile performs a fresh browser preflight. Keep
            # `scheduling` untouched here so an operator's explicit opt-out is
            # never undone by quota recovery.
            self._conn.execute(
                "UPDATE accounts_meta SET credit_balance=NULL, credit_checked_at=0, "
                "credit_disabled=0 WHERE credit_disabled=1 "
                "AND quota_blocked_until > 0 AND quota_blocked_until <= ?",
                (now,),
            )
            self._conn.execute(
                "UPDATE accounts_meta SET rate_limited_until=0, limit_reason='', "
                "quota_blocked_until=0, quota_reason='' "
                "WHERE (rate_limited_until > 0 AND rate_limited_until <= ?) "
                "OR (quota_blocked_until > 0 AND quota_blocked_until <= ?)", (now, now))
            # Profiles marked by the pre-recovery implementation could remain
            # scheduled with an auto-restore flag of zero. Once their marker
            # expires, promote those active rows into the same verification
            # path instead of silently clearing the risk state.
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_auto_restore=1, scheduling=0 "
                "WHERE cooldown_reason='risk_control' AND cooldown_auto_restore=0 "
                "AND scheduling=1 AND cooldown_until > 0 AND cooldown_until <= ?",
                (now,),
            )
            # An expired risk marker must not become schedulable in the small
            # window before the recovery loop verifies the browser session.
            self._conn.execute(
                "UPDATE accounts_meta SET scheduling=0 "
                "WHERE cooldown_reason='risk_control' AND cooldown_auto_restore=1 "
                "AND scheduling=1 AND cooldown_until > 0 AND cooldown_until <= ?",
                (now,),
            )
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_until=0, cooldown_reason='', "
                "cooldown_auto_restore=0, cooldown_global=0 "
                "WHERE cooldown_reason='risk_control' "
                "AND cooldown_auto_restore=0 AND cooldown_until > 0 "
                "AND cooldown_until <= ?",
                (now,),
            )
            # A plain provider-capacity response needs no browser/session
            # verification. Let this profile rejoin dispatch after its fixed
            # cooldown, without changing the operator's scheduling choice.
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_until=0, cooldown_reason='', "
                "cooldown_auto_restore=0, cooldown_global=0 "
                "WHERE cooldown_reason='provider_busy' AND cooldown_until > 0 "
                "AND cooldown_until <= ?",
                (now,),
            )
            # This UPDATE is called from read-oriented health/admin endpoints.
            # Commit even when rowcount is zero; otherwise SQLite can leave a
            # write transaction open after every status refresh.
            self._conn.commit()
        except sqlite3.OperationalError as exc:
            self._conn.rollback()
            if not _sqlite_is_locked(exc):
                raise

    def _mark_quota_blocked(self, account: str, reason: str = ""):
        self._ensure_meta(account)
        self._conn.execute(
            "UPDATE accounts_meta SET credit_disabled=1, cooldown_auto_restore=0, "
            "credit_checked_at=?, quota_blocked_until=?, quota_reason=?, "
            "last_used_at=? WHERE name=?",
            (time.time(), self._next_limit_reset(), reason[:300], time.time(), account),
        )
        self._conn.commit()

    def _mark_daily_limit(self, account: str, reason: str = ""):
        """Block scheduling until Dola's daily or rolling-period reset."""
        reset_days = 7 if ROLLING_VIDEO_LIMIT_PATTERN.search(str(reason or "")) else 1
        reset_at = self._provider_limit_reset_at(reason)
        if reset_at is None:
            reset_at = self._next_limit_reset(reset_days)
        self._conn.execute(
            "UPDATE accounts_meta SET last_used_at=?, rate_limited_until=?, limit_reason=?, "
            "quota_blocked_until=0, quota_reason='', credit_disabled=0 WHERE name=?",
            (time.time(), reset_at, reason[:300], account),
        )
        self._conn.commit()

    def _mark_rate_limited(self, account: str, reason: str = ""):
        """Pause a profile for a bounded interval after an explicit rate limit."""
        account = str(account or "").strip()
        if not account:
            return
        self._ensure_meta(account)
        now = time.time()
        until = now + PROVIDER_RATE_LIMIT_COOLDOWN_SEC
        self._conn.execute(
            "UPDATE accounts_meta SET last_used_at=?, "
            "rate_limited_until=MAX(COALESCE(rate_limited_until, 0), ?), "
            "limit_reason=?, quota_blocked_until=0, quota_reason='', "
            "credit_disabled=0 WHERE name=?",
            (
                now,
                until,
                f"Dola rate limit; tạm nghỉ {PROVIDER_RATE_LIMIT_COOLDOWN_SEC // 3600}h: "
                f"{str(reason or '')[:220]}"[:300],
                account,
            ),
        )
        self._conn.commit()
        self._availability_event.set()
        print(
            f"[pool] {account} Dola rate limit; pausing this profile for "
            f"{PROVIDER_RATE_LIMIT_COOLDOWN_SEC // 3600}h: {str(reason)[:180]}",
            flush=True,
        )

    def _mark_risk_control(
        self,
        account: str,
        reason: str = "",
    ):
        """Pause only the profile that received temporary Dola risk control.

        A logout/login wall seen before Dola accepts a conversation is local
        to the profile for this task, so callers can rotate safely even if the
        composer had already received a reference image or prompt. If Dola
        accepted a conversation, callers still do not replay that same task;
        unrelated tasks may continue on other eligible profiles.
        """
        self._ensure_meta(account)
        metadata = self._meta(account)
        # An account that was active before the risk response should be
        # automatically restored. Preserve a pending restore marker from the
        # legacy migration even if an old row was already scheduling=0. A
        # profile with login_ok=0 is also eligible: this is the common state
        # left by the previous verifier after it misclassified risk as logout.
        auto_restore = bool(
            metadata
            and (
                metadata["scheduling"]
                or metadata["cooldown_auto_restore"]
                or metadata["login_ok"] in (None, 0)
            )
        )
        self._conn.execute(
            "UPDATE accounts_meta SET cooldown_until=?, cooldown_reason=?, "
            "cooldown_auto_restore=?, cooldown_global=0 WHERE name=?",
            (
                time.time() + COOLDOWN_SEC,
                "risk_control",
                1 if auto_restore else 0,
                account,
            ),
        )
        self._conn.commit()
        print(
            f"[pool] {account} Dola risk control; pausing this profile for "
            f"{COOLDOWN_SEC // 3600}h{(COOLDOWN_SEC % 3600) // 60:02d}m: {str(reason)[:180]}",
            flush=True,
        )

    def _mark_provider_busy(self, account: str, reason: str = ""):
        """Pause a profile for 30 minutes after Dola reports high demand.

        This is separate from risk-control: it needs no browser/session
        verification and never changes the manual scheduling preference.
        """
        account = str(account or "").strip()
        if not account:
            return
        self._ensure_meta(account)
        until = time.time() + PROVIDER_BUSY_COOLDOWN_SEC
        self._conn.execute(
            "UPDATE accounts_meta SET cooldown_until=?, cooldown_reason='provider_busy', "
            "cooldown_auto_restore=0, cooldown_global=0 WHERE name=?",
            (until, account),
        )
        self._conn.commit()
        self._availability_event.set()
        print(
            f"[pool] {account} Dola high demand; pausing this profile for "
            f"{PROVIDER_BUSY_COOLDOWN_SEC // 60}m: "
            f"{str(reason)[:180]}",
            flush=True,
        )

    def list_accounts(self) -> list:
        """Dashboard view: combines metadata, quota, and busy status."""
        self._clear_expired_rate_limits()
        now = time.time()
        proxy_usage = self._proxy_dispatch_snapshot()
        out = []
        for a in self.accounts:
            m = self._meta(a)
            used = self.used_today(a)
            lock = self._locks.get(a)
            cooldown_until = _safe_float(m["cooldown_until"]) if m else 0.0
            rate_limited_until = _safe_float(m["rate_limited_until"]) if m else 0.0
            quota_blocked_until = _safe_float(m["quota_blocked_until"]) if m else 0.0
            credit_balance = m["credit_balance"] if m else None
            credit_checked_at = _safe_float(m["credit_checked_at"]) if m else 0.0
            credit_stale = self._credit_cache_is_stale(
                credit_balance, credit_checked_at, now=now
            )
            google_identity = google_profile_identity(self.accounts_dir / a)
            proxy_public = self.proxy_manager.account_public(a)
            proxy_id = str(proxy_public.get("proxy_id") or "").strip()
            proxy_stats = proxy_usage.get(
                proxy_id or GLOBAL_PROXY_USAGE_ID,
                {"dispatches": 0, "last_used_at": 0},
            )
            out.append({
                "name": a,
                "scheduling": bool(m["scheduling"]) if m else True,
                "note": m["note"] if m else "",
                "email": m["email"] if m else "",
                **google_identity,
                "created_at": _safe_float(m["created_at"]) if m else 0,
                "last_used_at": _safe_float(m["last_used_at"]) if m else 0,
                "login_ok": m["login_ok"] if m else None,
                "login_checked_at": _safe_float(m["login_checked_at"]) if m else 0,
                "cooldown_until": cooldown_until,
                "cooldown_reason": m["cooldown_reason"] if m else "",
                "cooldown_auto_restore": bool(m["cooldown_auto_restore"]) if m else False,
                "cooldown_global": bool(m["cooldown_global"]) if m else False,
                "cooling": cooldown_until > now,
                "rate_limited_until": rate_limited_until,
                "rate_limited": rate_limited_until > now,
                "limit_reason": m["limit_reason"] if m else "",
                "quota_blocked_until": quota_blocked_until,
                "quota_blocked": quota_blocked_until > now,
                "quota_reason": m["quota_reason"] if m else "",
                "credit_balance": credit_balance,
                "credit_checked_at": credit_checked_at,
                "credit_stale": credit_stale,
                **proxy_public,
                "proxy_dispatches_today": proxy_stats["dispatches"],
                "proxy_last_used_at": proxy_stats["last_used_at"],
                "used_today": used,
                "limit": DAILY_LIMIT,
                "remaining": max(0, DAILY_LIMIT - used),
                "busy": bool(lock and lock.locked()) or a in self._polling_accounts,
            })
            out[-1]["scheduler_reason"] = self._scheduler_reason(out[-1])
            # Expose the same readiness decision the dispatcher uses. The UI
            # must not infer availability from login_ok alone: a valid login
            # can still be manually disabled, busy, quota-blocked, or paused
            # by a provider risk/rate-limit response.
            out[-1]["dispatch_eligible"] = (
                self._schedulable(out[-1]) and not out[-1]["busy"]
            )
        return out

    def set_scheduling(self, name: str, on: bool, manual: bool = False):
        self._ensure_meta(name)
        if on and not manual and self._meta(name)["credit_disabled"]:
            return
        if on and manual:
            self._conn.execute("UPDATE accounts_meta SET credit_disabled=0 WHERE name=?", (name,))
            metadata = self._meta(name)
            now = time.time()
            temporary_block = bool(
                metadata
                and (
                    metadata["cooldown_reason"] == "risk_control"
                    or metadata["cooldown_reason"] == "provider_busy"
                    or _safe_float(metadata["rate_limited_until"]) > now
                )
            )
            if temporary_block:
                # The operator explicitly re-enabled this profile after a
                # successful manual video test. Clear only provider risk and
                # account-limit markers; quota blocks remain independently
                # enforced by the scheduler.
                self._conn.execute(
                    "UPDATE accounts_meta SET scheduling=1, login_ok=1, login_checked_at=?, "
                    "cooldown_until=0, cooldown_reason='', cooldown_auto_restore=0, "
                    "cooldown_global=0, rate_limited_until=0, limit_reason='' WHERE name=?",
                    (now, name),
                )
                self._conn.commit()
                self._availability_event.set()
                return
        if manual and not on:
            # An explicit dashboard disable must win over a pending automatic
            # risk recovery. Internal auth/render transitions use the default
            # path and keep the marker intact.
            self._conn.execute(
                "UPDATE accounts_meta SET scheduling=0, cooldown_auto_restore=0 WHERE name=?",
                (name,),
            )
        else:
            self._conn.execute(
                "UPDATE accounts_meta SET scheduling=? WHERE name=?",
                (1 if on else 0, name),
            )
        self._conn.commit()
        if on:
            self._availability_event.set()

    def set_email(self, name: str, email: str):
        self._ensure_meta(name)
        self._conn.execute(
            "UPDATE accounts_meta SET email=? WHERE name=?", (email, name))
        self._conn.commit()

    def set_proxy(self, name: str, proxy_id: str | None):
        """Assign or clear the managed proxy used by one local profile."""
        self._ensure_meta(name)
        if not hasattr(self, "proxy_manager"):
            self.proxy_manager = ProxyManager(getattr(config, "POOL_DB_PATH", "pool_usage.db"))
        return self.proxy_manager.assign(name, proxy_id)

    def proxy_for_account(
        self, name: str, *, minimum_remaining_sec: float = 0
    ) -> dict | None:
        """Resolve a profile proxy for Playwright, refreshing a due IP first."""
        manager = getattr(self, "proxy_manager", None)
        return (
            manager.proxy_for_account(
                name, minimum_remaining_sec=minimum_remaining_sec
            )
            if manager is not None
            else None
        )

    def set_login_status(self, name: str, ok: bool):
        self._ensure_meta(name)
        self._conn.execute(
            "UPDATE accounts_meta SET login_ok=?, login_checked_at=? WHERE name=?",
            (1 if ok else 0, time.time(), name),
        )
        self._conn.commit()

    def mark_manual_profile_unverified(self, name: str):
        """Keep a newly created manual profile out of rendering until verified."""
        self._ensure_meta(name)
        self._conn.execute(
            "UPDATE accounts_meta SET scheduling=1, login_ok=0, login_checked_at=? WHERE name=?",
            (time.time(), name),
        )
        self._conn.commit()

    def mark_session_verified(self, name: str, *, enable_scheduling: bool = False) -> bool:
        """Record a confirmed Dola session and clear a stale risk marker.

        A profile can keep a valid Dola cookie after a temporary risk wall. The
        old status path only changed ``login_ok`` after a later successful
        verification, leaving ``cooldown_reason='risk_control'`` in place, so
        the dashboard continued to show the profile as paused even though the
        operator had logged in again. Clear that marker only after a strict
        authenticated check has succeeded. Automatic/manual login flows may
        explicitly re-enable scheduling; a normal Verify keeps an operator's
        deliberate scheduling-off choice intact unless the row was awaiting
        automatic risk recovery.
        """
        self._ensure_meta(name)
        metadata = self._meta(name)
        had_risk_marker = bool(
            metadata and metadata["cooldown_reason"] == "risk_control"
        )
        restore_scheduling = bool(
            enable_scheduling
            or (
                had_risk_marker
                and bool(metadata["cooldown_auto_restore"])
            )
        )
        now = time.time()
        self._conn.execute(
            "UPDATE accounts_meta SET login_ok=1, login_checked_at=?, "
            "cooldown_until=CASE WHEN ?=1 THEN 0 ELSE cooldown_until END, "
            "cooldown_reason=CASE WHEN ?=1 THEN '' ELSE cooldown_reason END, "
            "cooldown_auto_restore=CASE WHEN ?=1 THEN 0 ELSE cooldown_auto_restore END, "
            "cooldown_global=CASE WHEN ?=1 THEN 0 ELSE cooldown_global END, "
            "scheduling=CASE WHEN ?=1 THEN 1 ELSE scheduling END WHERE name=?",
            (
                now,
                1 if had_risk_marker else 0,
                1 if had_risk_marker else 0,
                1 if had_risk_marker else 0,
                1 if had_risk_marker else 0,
                1 if restore_scheduling else 0,
                name,
            ),
        )
        self._conn.commit()
        if restore_scheduling:
            self._availability_event.set()
        return restore_scheduling

    async def _relogin_account_from_profile(self, name: str, email: str = "",
                                            timeout_sec: float | None = None) -> bool:
        """Restore Dola through the Google session already stored in a profile.

        Automatic video recovery uses a bounded timeout so a profile that cannot
        complete OAuth does not block the pool. Manual Login Dola calls keep
        their longer interactive timeout outside this helper.
        """
        # Import lazily to keep the pool usable by standalone worker imports
        # without creating an import cycle through server.py.
        from add_account import relogin_existing_account_flow
        from browser import check_login_state_details

        async with self._relogin_lock:
            interval_sec = 0 if timeout_sec is not None else config.LOGIN_INTERVAL_SEC
            wait_seconds = max(
                0.0,
                self._relogin_last_finished
                + interval_sec
                - time.monotonic(),
            )
            if wait_seconds > 0:
                print(
                    f"[pool] Automatic Dola relogin for {name} waiting "
                    f"{int(wait_seconds + 0.999)}s between Google flows",
                    flush=True,
                )
                await asyncio.sleep(wait_seconds)

            print(
                f"[pool] {name} Dola session expired; "
                "opening the existing profile to restore Dola via Gmail",
                flush=True,
            )
            try:
                # Automatic video recovery is bounded by the configured
                # timeout. The explicit Login Dola action still uses its own
                # 3-minute headed flow for manual CAPTCHA/2FA completion.
                flow_timeout = (
                    float(timeout_sec)
                    if timeout_sec is not None
                    else max(240, config.LOGIN_INTERVAL_SEC + 180)
                )
                result = await asyncio.wait_for(
                    relogin_existing_account_flow(
                        name, email, proxy=await asyncio.to_thread(self.proxy_for_account, name)
                    ),
                    timeout=flow_timeout,
                )
                if not result:
                    raise RuntimeError("profile relogin did not restore a Dola session")
                # The OAuth callback can look authenticated in the current
                # browser context before Chromium flushes the new cookies to
                # the persistent profile. Reopen the profile once after the
                # flow closes and only mark it usable when a fresh context
                # also sees an authenticated Dola page.
                persisted_state = await asyncio.wait_for(
                    check_login_state_details(
                        name,
                        profile_dir=self.accounts_dir / name,
                        proxy=await asyncio.to_thread(self.proxy_for_account, name),
                        timeout_sec=config.LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC,
                    ),
                    timeout=max(
                        15.0,
                        min(
                            config.LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC,
                            flow_timeout,
                        ),
                    ),
                )
                persisted = bool(
                    persisted_state.get("ok") or persisted_state.get("risk_control")
                )
                if persisted_state.get("risk_control"):
                    self._mark_risk_control(
                        name,
                        "automatic Gmail relogin completed while Dola risk wall remained",
                    )
                elif persisted_state.get("ok"):
                    # A fresh authenticated read supersedes an older local
                    # risk marker. Otherwise automatic relogin could return
                    # success while the scheduler still hid the profile in
                    # the dashboard until the three-hour cooldown elapsed.
                    self.mark_session_verified(name, enable_scheduling=True)
                if not persisted:
                    raise RuntimeError(
                        "profile relogin completed but a fresh Chromium check "
                        "still shows Dola logged out"
                    )
                print(f"[pool] {name} Dola session restored via Gmail profile", flush=True)
                return True
            finally:
                self._relogin_last_finished = time.monotonic()

    def set_note(self, name: str, note: str):
        self._ensure_meta(name)
        self._conn.execute(
            "UPDATE accounts_meta SET note=? WHERE name=?", (note, name))
        self._conn.commit()

    def delete_account(self, name: str):
        lock = self._locks.get(name)
        if lock and lock.locked():
            raise RuntimeError("Account is generating video, cannot delete")
        d = self.accounts_dir / name
        if d.exists():
            shutil.rmtree(d)
        self._conn.execute("DELETE FROM accounts_meta WHERE name=?", (name,))
        self._conn.commit()

    def account_lock(self, name: str) -> asyncio.Lock:
        """Returns the shared in-process lock for a persistent profile."""
        return self._locks.setdefault(name, asyncio.Lock())

    def account_is_busy(self, name: str) -> bool:
        lock = self._locks.get(name)
        return bool(lock and lock.locked()) or name in self._polling_accounts

    def reserve_for_poll(self, name: str):
        """Reserves an account while an accepted conversation is being polled."""
        if name:
            self._polling_accounts.add(name)

    def release_poll_reservation(self, name: str):
        """Releases a poll reservation after completion or terminal failure."""
        if name:
            self._polling_accounts.discard(name)
        self._availability_event.set()

    async def replace_account_profile(self, name: str, staged_dir: str | Path):
        """Atomically installs a staged login profile after OAuth succeeds."""
        staged = Path(staged_dir)
        if not staged.is_dir():
            raise FileNotFoundError(f"Staged profile does not exist: {staged}")
        target = self.accounts_dir / name
        backup = self.accounts_dir / f".{name}.old-{uuid.uuid4().hex}"
        lock = self.account_lock(name)
        async with lock:
            moved_old = False
            installed = False
            try:
                if target.exists():
                    target.rename(backup)
                    moved_old = True
                staged.rename(target)
                installed = True
            except Exception:
                if moved_old and not target.exists() and backup.exists():
                    backup.rename(target)
                raise
            finally:
                # Only remove the backup after the new profile is in place.
                # If an install/restore fails, leave the backup for manual
                # recovery instead of silently deleting the last good session.
                if installed and moved_old and backup.exists():
                    shutil.rmtree(backup, ignore_errors=True)

    async def verify_account(self, name: str, *, chat_probe: bool = False) -> bool:
        """Verifies login state in headless mode and updates cache.

        ``chat_probe`` is retained as a compatibility argument for callers
        from older builds. Login verification is deliberately page-based now:
        sending a test chat after OAuth can block on Dola's send control and
        falsely mark a valid session as failed.
        """
        if name not in self.accounts:
            raise FileNotFoundError(f"Profile does not exist: {name}")
        lock = self.account_lock(name)
        async with lock:
            metadata = self._meta(name)
            selected_proxy = await asyncio.to_thread(self.proxy_for_account, name)
            state = await asyncio.to_thread(
                _run_login_state_check_in_worker,
                name,
                self.accounts_dir / name,
                selected_proxy,
                config.LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC,
            )
            risk_control = bool(state.get("risk_control"))
            if risk_control:
                self._mark_risk_control(
                    name,
                    "profile kiểm tra thấy login wall nhưng cookie Dola vẫn còn",
                )
            if state.get("ok"):
                # A strict authenticated read is stronger than the previous
                # risk marker. Clear stale cooldown metadata and restore a row
                # that was waiting for automatic risk recovery.
                self.mark_session_verified(name)
                return True
            # A risk wall with a valid cookie is recoverable, but it is not
            # schedulable until a later recovery check sees a clean page.
            ok = bool(state.get("ok"))
            self._conn.execute(
                "UPDATE accounts_meta SET login_ok=?, login_checked_at=?, "
                "cooldown_until=CASE WHEN ?=1 THEN cooldown_until ELSE 0 END, "
                "cooldown_reason=CASE WHEN ?=1 THEN cooldown_reason ELSE '' END, "
                "cooldown_auto_restore=CASE WHEN ?=1 THEN cooldown_auto_restore ELSE 0 END, "
                "cooldown_global=CASE WHEN ?=1 THEN cooldown_global ELSE 0 END, "
                "scheduling=CASE WHEN ?=0 THEN 0 "
                "WHEN ?=1 THEN 1 ELSE scheduling END WHERE name=?",
                (
                    1 if ok else 0,
                    time.time(),
                    1 if risk_control else 0,
                    1 if risk_control else 0,
                    1 if risk_control else 0,
                    1 if risk_control else 0,
                    1 if ok else 0,
                    1 if risk_control and metadata and metadata["login_ok"] in (None, 0) else 0,
                    name,
                ),
            )
            self._conn.commit()
            return ok

    async def recover_expired_risk_accounts(self) -> list[str]:
        """Recheck risk-controlled profiles and restore eligible scheduling.

        Recovery is intentionally conservative: a profile is re-enabled only
        when its persistent Dola session is authenticated again. If the risk
        wall is still present, the cooldown is extended; if the cookie is gone,
        the profile becomes a normal expired-session account and stays disabled
        until the operator logs it in.
        """
        recovered: list[str] = []
        async with self._risk_recovery_lock:
            now = time.time()
            # Repair active legacy markers at the expiry boundary before
            # selecting rows for the browser verification pass.
            self._conn.execute(
                "UPDATE accounts_meta SET cooldown_auto_restore=1, scheduling=0 "
                "WHERE cooldown_reason='risk_control' AND cooldown_auto_restore=0 "
                "AND scheduling=1 AND cooldown_until > 0 AND cooldown_until <= ?",
                (now,),
            )
            self._conn.execute(
                "UPDATE accounts_meta SET scheduling=0 "
                "WHERE cooldown_reason='risk_control' AND cooldown_auto_restore=1 "
                "AND scheduling=1 AND cooldown_until > 0 AND cooldown_until <= ?",
                (now,),
            )
            self._conn.commit()
            rows = self._conn.execute(
                "SELECT name, cooldown_auto_restore FROM accounts_meta "
                "WHERE cooldown_reason='risk_control' "
                "AND cooldown_auto_restore=1 "
                "AND cooldown_until > 0 AND cooldown_until <= ?",
                (now,),
            ).fetchall()
            if not rows:
                return recovered
            for row in rows:
                name = str(row["name"])
                if self.account_is_busy(name):
                    continue
                lock = self.account_lock(name)
                if lock.locked():
                    continue
                async with lock:
                    current = self._meta(name)
                    if not current or current["cooldown_reason"] != "risk_control":
                        continue
                    if float(current["cooldown_until"] or 0) > time.time():
                        continue
                    try:
                        selected_proxy = await asyncio.to_thread(
                            self.proxy_for_account, name
                        )
                        state = await asyncio.to_thread(
                            _run_login_state_check_in_worker,
                            name,
                            self.accounts_dir / name,
                            selected_proxy,
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        # Keep the marker so a transient browser/network error
                        # can be retried on the next recovery interval.
                        print(
                            f"[pool] {name} risk recovery check failed; will retry: "
                            f"{str(exc)[:180]}",
                            flush=True,
                        )
                        continue
                    checked_at = time.time()
                    auto_restore = bool(current["cooldown_auto_restore"])
                    if state.get("ok"):
                        self._conn.execute(
                            "UPDATE accounts_meta SET login_ok=1, login_checked_at=?, "
                            "scheduling=CASE WHEN ?=1 AND credit_disabled=0 THEN 1 ELSE scheduling END, "
                            "cooldown_until=0, cooldown_reason='', cooldown_auto_restore=0, "
                            "cooldown_global=0 "
                            "WHERE name=?",
                            (checked_at, 1 if auto_restore else 0, name),
                        )
                        self._conn.commit()
                        recovered.append(name)
                        print(
                            f"[pool] {name} Dola risk cooldown expired; session verified "
                            "and profile scheduling restored",
                            flush=True,
                        )
                    elif state.get("risk_control"):
                        self._conn.execute(
                            "UPDATE accounts_meta SET login_ok=1, login_checked_at=?, "
                            "cooldown_until=?, cooldown_reason='risk_control', "
                            "cooldown_auto_restore=? WHERE name=?",
                            (
                                checked_at,
                                checked_at + COOLDOWN_SEC,
                                1 if auto_restore else 0,
                                name,
                            ),
                        )
                        self._conn.commit()
                        print(
                            f"[pool] {name} still shows Dola risk control; extending "
                            f"cooldown for {COOLDOWN_SEC // 3600}h",
                            flush=True,
                        )
                    else:
                        self._conn.execute(
                            "UPDATE accounts_meta SET login_ok=0, login_checked_at=?, "
                            "scheduling=0, cooldown_until=0, cooldown_reason='', "
                            "cooldown_auto_restore=0, cooldown_global=0 WHERE name=?",
                            (checked_at, name),
                        )
                        self._conn.commit()
                        print(
                            f"[pool] {name} risk cooldown expired but Dola session is "
                            "gone; leaving profile disabled until Login Dola",
                            flush=True,
                        )
        if recovered:
            self._availability_event.set()
        return recovered

    # ===== Scheduling =====

    @staticmethod
    def _proxy_usage_id(account_meta: dict) -> str:
        """Return the persisted proxy bucket used for fairness decisions."""
        return str(account_meta.get("proxy_id") or GLOBAL_PROXY_USAGE_ID)

    def _release_active_proxy(self, proxy_id: str | None):
        if not proxy_id:
            return
        current = self._active_proxy_dispatches.get(proxy_id, 0)
        if current <= 1:
            self._active_proxy_dispatches.pop(proxy_id, None)
        else:
            self._active_proxy_dispatches[proxy_id] = current - 1
        # Do not signal the queue here. This method also runs after every
        # pre-submit proxy failure; waking all waiters for each failed scan
        # creates a thundering-herd retry loop. The queue timeout provides the
        # retry path for transient proxy state, while release_poll_reservation
        # signals immediately when an accepted profile truly becomes free.

    def _mark_dispatch(self, account: str):
        self._ensure_meta(account)
        now = time.time()
        metadata = self._meta(account)
        proxy_id = str(metadata["proxy_id"] or "").strip() if metadata else ""
        proxy_usage_id = proxy_id or GLOBAL_PROXY_USAGE_ID
        self._conn.execute(
            "UPDATE accounts_meta SET last_used_at=? WHERE name=?",
            (now, account),
        )
        self._conn.execute(
            "INSERT INTO proxy_usage(proxy_id, day, dispatches, last_used_at) "
            "VALUES (?,?,1,?) "
            "ON CONFLICT(proxy_id, day) DO UPDATE SET "
            "dispatches=dispatches+1, last_used_at=excluded.last_used_at",
            (proxy_usage_id, _usage_day(), now),
        )
        self._conn.commit()

    def _set_credit_balance(self, account: str, balance: int, source: str = ""):
        self._ensure_meta(account)
        balance = max(0, int(balance))
        self._conn.execute(
            "UPDATE accounts_meta SET credit_balance=?, credit_checked_at=?, "
            "credit_disabled=0, quota_blocked_until=0, quota_reason='' WHERE name=?",
            (balance, time.time(), account),
        )
        self._conn.commit()

    @staticmethod
    def _credit_cache_is_stale(balance, checked_at, *, now: float | None = None) -> bool:
        if balance is None:
            return False
        checked = _safe_float(checked_at)
        current = time.time() if now is None else now
        return checked <= 0 or _usage_day(checked) != _usage_day(current)

    @staticmethod
    def _scheduler_reason(account: dict) -> str:
        if not account.get("scheduling", True):
            return "Điều phối đang tắt"
        if account.get("cooling"):
            if account.get("cooldown_reason") == "provider_busy":
                return "Tạm nghỉ do Dola quá tải"
            return "Tạm nghỉ do risk-control"
        if account.get("rate_limited"):
            return "Dola đang giới hạn profile này"
        if account.get("used_today", 0) >= account.get("limit", DAILY_LIMIT):
            return "Đã đạt giới hạn lượt nội bộ hôm nay"
        login_ok = account.get("login_ok")
        if login_ok is not None and not bool(login_ok):
            return "Session Dola cần đăng nhập lại"
        if account.get("busy"):
            return "Profile đang xử lý job khác"
        balance = account.get("credit_balance")
        if balance is not None and balance < 2:
            return f"Còn {balance} credit; Dola sẽ xác nhận theo chế độ video"
        if account.get("credit_stale"):
            return "Credit cache đã cũ; sẽ được cập nhật khi profile được chọn"
        if balance is None:
            return "Chưa có số dư cache; sẽ kiểm tra trước khi gửi"
        return "Sẵn sàng nhận job"

    def _schedulable(self, a: dict) -> bool:
        login_ok = a.get("login_ok")
        return (a["scheduling"] and not a["cooling"] and not a["rate_limited"]
                and a["used_today"] < DAILY_LIMIT
                and (login_ok is None or bool(login_ok))
                and a["name"] not in self._polling_accounts)

    @property
    def all_accounts_limited(self) -> bool:
        """Returns True if all active accounts have reached daily limit."""
        candidates = [a for a in self.list_accounts() if a["scheduling"] and not a["cooling"]]
        return bool(candidates) and all(
            a["rate_limited"] or a["used_today"] >= DAILY_LIMIT for a in candidates
        )

    @property
    def all_accounts_quota_blocked(self) -> bool:
        # Backward-compatible property. Credit amount is not an account-wide
        # dispatch lock; only a fresh provider rate-limit response pauses it.
        return False

    @property
    def available(self) -> bool:
        return any(self._schedulable(a) for a in self.list_accounts())

    @property
    def cookie_count(self) -> int:  # /health compatibility
        return len(self.accounts)

    def account_status(self) -> list:
        return [{
            "account": a["name"], "used_today": a["used_today"], "limit": a["limit"],
            "rate_limited": a["rate_limited"], "rate_limited_until": a["rate_limited_until"],
            "quota_blocked": a["quota_blocked"], "quota_blocked_until": a["quota_blocked_until"],
            "cooling": a["cooling"], "cooldown_until": a["cooldown_until"],
            "cooldown_reason": a["cooldown_reason"],
            "cooldown_global": a["cooldown_global"],
        } for a in self.list_accounts()]

    def health_snapshot(self) -> dict:
        """Read the health payload through a connection dedicated to this call.

        ``/health`` is served in a worker thread so profile/filesystem scans do
        not block video admission.  Reusing ``self._conn`` from that thread
        while a render task writes through the event-loop thread can make the
        stdlib SQLite wrapper report ``bad parameter or other API misuse``.
        The health endpoint only needs a read-only account/quota snapshot, so
        use an independent connection and leave the worker connection alone.
        """
        account_names = sorted(
            d.name
            for d in self.accounts_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        ) if self.accounts_dir.exists() else []
        conn = sqlite3.connect(
            self.db_path,
            timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
            metadata = {
                str(row["name"]): row
                for row in conn.execute("SELECT * FROM accounts_meta").fetchall()
            }
            today = _usage_day()
            usage = {
                str(row["account"]): max(0, int(row["used"] or 0))
                for row in conn.execute(
                    "SELECT account, used FROM usage WHERE day=?", (today,)
                ).fetchall()
            }
        finally:
            conn.close()

        now = time.time()
        accounts = []
        available = False
        for name in account_names:
            m = metadata.get(name)
            used = usage.get(name, 0)
            cooldown_until = _safe_float(m["cooldown_until"]) if m else 0.0
            rate_limited_until = _safe_float(m["rate_limited_until"]) if m else 0.0
            quota_blocked_until = _safe_float(m["quota_blocked_until"]) if m else 0.0
            cooling = cooldown_until > now
            rate_limited = rate_limited_until > now
            quota_blocked = quota_blocked_until > now
            scheduling = bool(m["scheduling"]) if m else True
            login_ok = m["login_ok"] if m else None
            credit_balance = m["credit_balance"] if m else None
            credit_checked_at = _safe_float(m["credit_checked_at"]) if m else 0.0
            credit_stale = self._credit_cache_is_stale(
                credit_balance, credit_checked_at, now=now
            )
            busy = self.account_is_busy(name)
            accounts.append({
                "account": name,
                "used_today": used,
                "limit": DAILY_LIMIT,
                "rate_limited": rate_limited,
                "rate_limited_until": rate_limited_until,
                "quota_blocked": quota_blocked,
                "quota_blocked_until": quota_blocked_until,
                "cooling": cooling,
                "cooldown_until": cooldown_until,
                "cooldown_reason": (m["cooldown_reason"] or "") if m else "",
                "cooldown_global": bool(m["cooldown_global"]) if m else False,
            })

            if (
                scheduling
                and not cooling
                and not rate_limited
                and used < DAILY_LIMIT
                and (login_ok is None or bool(login_ok))
                and not busy
            ):
                available = True

        return {"accounts": accounts, "available": available}

    async def resume_video(self, account: str, conversation_id: str, timeout: int,
                           on_poll=None, on_balance=None,
                           duration: int | None = None,
                           ratio: str | None = None, model: str | None = None,
                           prompt_text: str | None = None,
                           confirm_duration: bool = False,
                           task_id: str | None = None) -> dict:
        """Resumes an accepted session without re-scheduling."""
        if not hasattr(self, "_dispatch_selection_lock"):
            self._dispatch_selection_lock = asyncio.Lock()
        if not hasattr(self, "_active_proxy_dispatches"):
            self._active_proxy_dispatches = {}
        async with self.semaphore:
            lock = self._locks.setdefault(account, asyncio.Lock())
            async with lock:
                metadata = self._meta(account)
                dispatch_proxy_id = (
                    str(metadata["proxy_id"] or "")
                    if metadata else ""
                ) or GLOBAL_PROXY_USAGE_ID
                async with self._dispatch_selection_lock:
                    self._active_proxy_dispatches[dispatch_proxy_id] = (
                        self._active_proxy_dispatches.get(dispatch_proxy_id, 0) + 1
                    )
                def report_balance(balance, source=""):
                    self._set_credit_balance(account, balance, source)
                    if on_balance:
                        on_balance(balance, source)
                relogin_attempted = False
                try:
                    while True:
                        try:
                            result = await resume_video(
                                account,
                                conversation_id,
                                timeout,
                                on_poll=on_poll,
                                on_balance=report_balance,
                                duration=duration,
                                ratio=ratio,
                                model=model,
                                prompt_text=prompt_text,
                                confirm_duration=confirm_duration,
                                proxy=await asyncio.to_thread(self.proxy_for_account, account),
                            )
                            break
                        except SessionExpiredError as exc:
                            if relogin_attempted:
                                raise
                            relogin_attempted = True
                            self.set_login_status(account, False)
                            self.set_scheduling(account, False)
                            metadata = self._meta(account)
                            email = str(metadata["email"] or "") if metadata else ""
                            try:
                                await self._relogin_account_from_profile(
                                    account,
                                    email,
                                    timeout_sec=config.AUTO_RELOGIN_TIMEOUT_SEC,
                                )
                            except Exception as relogin_error:
                                reason = str(relogin_error).strip() or relogin_error.__class__.__name__
                                raise SessionExpiredError(
                                    f"{account} Dola session expired while resuming "
                                    f"{conversation_id}; automatic Gmail relogin failed: "
                                    f"{reason[:220]}"
                                ) from relogin_error
                            self.set_login_status(account, True)
                            self.set_scheduling(account, True)
                            print(
                                f"[pool] {account} relogged automatically; "
                                f"resuming conversation {conversation_id}",
                                flush=True,
                            )
                    # Count only after the provider returned a video that was
                    # downloaded and validated by the worker.
                    self._claim(
                        account,
                        result.get("conversation_id") or conversation_id,
                        task_id=task_id,
                    )
                    self._conn.execute(
                        "UPDATE accounts_meta SET last_used_at=? WHERE name=?",
                        (time.time(), account))
                    self._conn.commit()
                    return result
                except TimeoutError:
                    # The server may continue polling this accepted
                    # conversation. A non-result is not a local credit claim.
                    raise
                except VideoValidationError:
                    raise
                except PostSubmitCreditError as e:
                    # This request's cost was rejected. Do not turn that
                    # model-specific result into an account-wide credit pause.
                    raise
                except PostSubmitAccountLimitError as e:
                    self._mark_daily_limit(account, str(e))
                    raise
                except PostSubmitRateLimitError as e:
                    self._mark_rate_limited(account, str(e))
                    raise
                except RiskControlError as e:
                    # A conversation already exists while resuming, so a
                    # risk response must not replay this same task. Cool only
                    # this profile so unrelated tasks can use other accounts.
                    self._mark_risk_control(account, str(e))
                    raise
                except SessionExpiredError:
                    self.set_login_status(account, False)
                    self.set_scheduling(account, False)
                    self._conn.commit()
                    raise
                finally:
                    async with self._dispatch_selection_lock:
                        self._release_active_proxy(dispatch_proxy_id)

    async def _generate_video_once(self, prompt: str, ratio: str = None,
                                   duration: int = None,
                                   model: str = "seedance_v2.5",
                                   on_conversation_id=None, on_profile_bound=None,
                                   on_poll=None,
                                   on_balance=None,
                                   reference_image_paths: list[str] | None = None,
                                   on_timing=None,
                                   task_id: str | None = None,
                                   preferred_account: str | None = None,
                                   on_account_rotation=None,
                                   excluded_accounts=None,
                                   chat_mode: str | None = None,
                                   stop_on_credit: bool = False,
                                   on_account_attempt=None) -> dict:
        """Attempts one dispatch pass and releases the semaphore while waiting."""
        # A few lifecycle integrations construct a lightweight pool fixture
        # without running __init__. Keep this dispatch path compatible with
        # those callers while normal application instances initialize these
        # fields eagerly in the constructor.
        if not hasattr(self, "_dispatch_selection_lock"):
            self._dispatch_selection_lock = asyncio.Lock()
        if not hasattr(self, "_active_proxy_dispatches"):
            self._active_proxy_dispatches = {}
        async with self.semaphore:
            last_err = None
            busy = False
            proxy_unavailable = False
            risk_control_attempts = 0
            accounts = sorted(
                self.list_accounts(),
                key=lambda item: (
                    # The internal account quota is the primary fairness
                    # target. Proxy health and active proxy load are only
                    # tie-breakers; neither may block a free profile or reduce
                    # the configured concurrency.
                    item.get("used_today", 0),
                    str(item.get("proxy_status") or "").lower() == "error",
                    self._active_proxy_dispatches.get(
                        self._proxy_usage_id(item), 0
                    ),
                    item.get("proxy_dispatches_today", 0),
                    item.get("last_used_at", 0) or 0,
                    item["name"],
                ),
            )
            if not accounts:
                raise RuntimeError("No available accounts in pool: no accounts")
            excluded_account_names = {
                str(name).strip()
                for name in (excluded_accounts or ())
                if str(name).strip()
            }
            # Explicitly requested profiles take precedence. Automatic
            # provider-overload recovery, however, must move to a profile that
            # has not already returned the same overload for this task.
            if excluded_account_names and not preferred_account:
                accounts = [
                    item for item in accounts
                    if item["name"] not in excluded_account_names
                ]
                if not accounts:
                    raise RuntimeError(
                        "No untried account profiles remain for task recovery"
                    )
            if preferred_account:
                accounts = [
                    item for item in accounts
                    if item["name"] == str(preferred_account).strip()
                ]
                if not accounts:
                    raise RuntimeError(
                        "Profile đã gắn với task không còn trong pool: "
                        f"{preferred_account}"
                    )

            for account_meta in accounts:
                if not self._schedulable(account_meta):
                    if account_meta.get("busy"):
                        busy = True
                    continue
                account = account_meta["name"]
                lock = self.account_lock(account)
                # A task waiting for a profile must not turn into a false
                # failure just because another task owns that profile lock.
                if lock.locked():
                    busy = True
                    continue
                async with lock:
                    current = next(
                        (item for item in self.list_accounts() if item["name"] == account),
                        None,
                    )
                    if not current or not self._schedulable(current):
                        if current and current["busy"]:
                            busy = True
                        continue
                    if on_account_attempt:
                        try:
                            on_account_attempt(account)
                        except Exception:
                            # Per-task retry bookkeeping must not interrupt a
                            # provider attempt if its callback fails.
                            pass
                    dispatch_proxy_id = self._proxy_usage_id(current)
                    async with self._dispatch_selection_lock:
                        # The account lock prevents duplicate use of one
                        # profile. Proxy diversity is already handled by the
                        # sort hints above; never skip this profile merely
                        # because another proxy appears idle. That proxy may
                        # be unhealthy or in lease backoff, and a proxy bucket
                        # is not a concurrency limit.
                        self._mark_dispatch(account)
                        self._active_proxy_dispatches[dispatch_proxy_id] = (
                            self._active_proxy_dispatches.get(dispatch_proxy_id, 0) + 1
                        )
                    # Reserve the turn before yielding to another worker.
                    # Successful-video counts are still claimed only after
                    # download/validation; the active proxy reservation keeps
                    # concurrent jobs from clustering on one proxy.
                    provider_accepted = False
                    profile_bound = False
                    relogin_attempted = False
                    attachment_recovery_attempted = False

                    def mark_profile_bound(account_name):
                        """Make the profile sticky once composer input is uploaded."""
                        nonlocal profile_bound
                        if profile_bound:
                            return
                        profile_bound = True
                        print(
                            f"[pool] {account_name} profile bound to task input; keeping this profile"
                            f" (task={task_id or 'unknown'})",
                            flush=True,
                        )
                        if on_profile_bound:
                            on_profile_bound(account_name)

                    def remember_conversation(account_name, conversation_id, deadline_at):
                        """Remember the provider boundary before forwarding it to the task store."""
                        nonlocal provider_accepted
                        provider_accepted = True
                        if on_conversation_id:
                            on_conversation_id(account_name, conversation_id, deadline_at)

                    async def wait_for_submission_slot():
                        """Throttle only the provider send action, never profile startup."""
                        interval = max(
                            0.0,
                            float(getattr(config, "SUBMISSION_INTERVAL_SEC", 0.0)),
                        )
                        async with self._submission_gate:
                            now = time.monotonic()
                            wait_for_interval = interval - (now - self._last_submission_at)
                            if wait_for_interval > 0:
                                if on_timing:
                                    on_timing("current_stage", "waiting_submission_slot")
                                print(
                                    f"[pool] task={task_id or 'unknown'} profile={account} "
                                    f"đã sẵn sàng; chờ {wait_for_interval:.1f}s đến lượt gửi Dola",
                                    flush=True,
                                )
                                # Keep the lock while waiting so simultaneous
                                # workers reserve distinct send slots instead
                                # of waking together and flooding Dola.
                                await asyncio.sleep(wait_for_interval)
                            self._last_submission_at = time.monotonic()
                        if on_timing:
                            on_timing("current_stage", "submitting_prompt")

                    try:
                        def on_balance(balance, source=""):
                            self._set_credit_balance(account, balance, source)

                        while True:
                            try:
                                # The proxy lease is fixed for the lifetime of
                                # the Chromium context. Resolve it before
                                # opening the profile; the provider send gate
                                # runs later, immediately before the prompt is
                                # submitted.
                                proxy = await asyncio.to_thread(
                                    self.proxy_for_account,
                                    account,
                                    minimum_remaining_sec=(
                                        config.VIDEO_PROXY_MIN_REMAINING_SEC
                                    ),
                                )
                                result = await generate_video(
                                    account, prompt, ratio, duration, model=model,
                                    on_conversation_id=remember_conversation, on_poll=on_poll,
                                    on_balance=on_balance, reference_image_paths=reference_image_paths,
                                    on_timing=on_timing, task_id=task_id,
                                    on_profile_bound=mark_profile_bound,
                                    before_submission=wait_for_submission_slot,
                                    proxy=proxy,
                                    chat_mode=chat_mode)
                                break
                            except PreSubmitAttachmentSetupError as e:
                                if profile_bound and not attachment_recovery_attempted:
                                    # The route guard saw stale attachments
                                    # before Dola accepted the request. Stay
                                    # on this persistent profile for one hard
                                    # composer reset; an outer-loop continue
                                    # would rotate and replay the manifest.
                                    attachment_recovery_attempted = True
                                    print(
                                        f"[pool] {account} stale attachment payload; "
                                        "dọn composer và thử lại cùng profile một lần: "
                                        f"{str(e)[:180]}",
                                        flush=True,
                                    )
                                    continue
                                raise
                            except FreshChatRetryError:
                                # This provider response means the current
                                # conversation produced no video. Propagate the
                                # provider rejection without opening a second
                                # chat or hiding the signal behind a generic
                                # pre-submit error.
                                raise
                            except SessionExpiredError as e:
                                # A session failure before the provider accepts
                                # a conversation is safe to recover in-place.
                                # Once a conversation exists, never submit the
                                # same prompt again; the normal poll recovery
                                # path must handle that accepted conversation.
                                if (
                                    provider_accepted
                                    or relogin_attempted
                                    or (
                                        profile_bound
                                        and not getattr(e, "retry_same_profile", False)
                                    )
                                ):
                                    raise
                                relogin_attempted = True
                                self.set_login_status(account, False)
                                self.set_scheduling(account, False)
                                email = str(current.get("email") or account_meta.get("email") or "")
                                try:
                                    await self._relogin_account_from_profile(
                                        account,
                                        email,
                                        timeout_sec=config.AUTO_RELOGIN_TIMEOUT_SEC,
                                    )
                                except Exception as relogin_error:
                                    reason = str(relogin_error).strip() or relogin_error.__class__.__name__
                                    raise SessionExpiredError(
                                        f"{account} Dola session expired before video submission; "
                                        "automatic Gmail relogin failed: "
                                        f"{reason[:220]}"
                                    ) from relogin_error
                                self.set_login_status(account, True)
                                self.set_scheduling(account, True)
                                print(
                                    f"[pool] {account} relogged automatically; "
                                    "retrying the same video submission",
                                    flush=True,
                                )
                        self._claim(
                            account,
                            result.get("conversation_id"),
                            task_id=task_id,
                        )
                        self._conn.execute(
                            "UPDATE accounts_meta SET last_used_at=? WHERE name=?",
                            (time.time(), account))
                        self._conn.commit()
                        return result
                    except FreshChatRetryError:
                        # This is a provider no-video retry response, not a
                        # profile-local pre-submit error. Let the task worker
                        # apply the appropriate bounded recovery policy.
                        raise
                    except CreditInsufficientError as e:
                        if provider_accepted or profile_bound:
                            raise
                        print(
                            f"[pool] {account} Dola rejected this request's credit cost; "
                            f"rotating: {e}",
                            flush=True,
                        )
                        last_err = e
                        continue
                    except ProxyLeaseExpiringError as e:
                        # This is a profile-local startup condition. The
                        # browser has not been opened and Dola has not seen
                        # the prompt, so the next profile can safely take the
                        # task. If every profile is in this state, wait for
                        # the background ProxyFB rotation to publish a fresh
                        # endpoint instead of failing a valid task.
                        proxy_unavailable = True
                        last_err = e
                        print(
                            f"[pool] {account} rotating proxy lease too short; "
                            f"skipping profile: {str(e)[:180]}",
                            flush=True,
                        )
                        continue
                    except ProxyFBError as e:
                        # Proxy refresh/check errors happen before Chromium
                        # starts. Rotate to another profile when possible and
                        # preserve the existing fail-safe behaviour if none is
                        # usable.
                        proxy_unavailable = True
                        last_err = e
                        # A cached ProxyFB backoff is expected while a queue
                        # waits for a healthy profile. Avoid writing the same
                        # line on every two-second scan; real checker/API
                        # failures are still logged on the first pass.
                        if "đang backoff" not in str(e).lower():
                            print(
                                f"[pool] {account} proxy unavailable before video startup; "
                                f"rotating: {str(e)[:180]}",
                                flush=True,
                            )
                        continue
                    except AccountLimitedError as e:
                        if provider_accepted or profile_bound:
                            raise
                        print(f"[pool] {account} reached daily limit, rotating: {e}", flush=True)
                        self._mark_daily_limit(account, str(e))
                        last_err = e
                        continue
                    except CreditError as e:
                        if provider_accepted or profile_bound:
                            # Do not submit the same prompt through another
                            # profile after its composer has received the input.
                            print(f"[pool] {account} credit error after profile binding: {e}", flush=True)
                            raise
                        print(f"[pool] {account} credit error before submission, rotating: {e}", flush=True)
                        last_err = e
                        continue
                    except RateLimitError as e:
                        self._mark_rate_limited(account, str(e))
                        if provider_accepted:
                            # A durable conversation exists; the server will
                            # rotate only after this poll reservation is released.
                            # Normalize legacy workers that raise the base
                            # RateLimitError after acceptance. The server's
                            # post-submit handler is what releases the current
                            # reservation and retries this task on another
                            # profile; a plain RateLimitError would instead
                            # mark the task terminal (or leave recovery to a
                            # later poll window).
                            post_submit_error = _post_submit_rate_limit_error(e)
                            if post_submit_error is e:
                                raise
                            raise post_submit_error from e
                        print(
                            f"[pool] {account} pre-submit Dola rate limit; rotating: "
                            f"{str(e)[:180]}",
                            flush=True,
                        )
                        last_err = e
                        continue
                    except RiskControlError as e:
                        pre_submit_risk = _is_pre_submit_risk_control(e)
                        if provider_accepted or (profile_bound and not pre_submit_risk):
                            # The provider may already own this task. Never
                            # submit it again through another profile, but do
                            # not globally block unrelated tasks. Cool only
                            # the profile that returned the risk challenge.
                            self._mark_risk_control(account, str(e))
                            raise
                        # A risk response before a conversation is accepted
                        # (including a logout/login wall or a rate-limit
                        # response explicitly saying no conversation was
                        # accepted) is safe to classify as account-level risk
                        # control. Keep this profile in the pool, then inspect
                        # the next one.
                        risk_control_attempts += 1
                        self._mark_risk_control(account, str(e))
                        last_err = e
                        print(
                            f"[pool] {account} pre-submit risk-control; rotating "
                            f"({risk_control_attempts}/{config.RISK_CONTROL_MAX_PROFILES})",
                            flush=True,
                        )
                        if risk_control_attempts >= config.RISK_CONTROL_MAX_PROFILES:
                            raise RiskControlError(
                                "Dola risk-control đã xảy ra trên "
                                f"{risk_control_attempts} profile; dừng kiểm tra "
                                "trong lượt chạy này. Lượt sau sẽ kiểm tra lại "
                                "sau khi cooldown hết hạn."
                            ) from e
                        continue
                    except TimeoutError as e:
                        # A timeout before conversation_id means the request was
                        # not confirmed by Dola, so it must not consume a local
                        # attempt. Try the next profile. Once assigned, never
                        # re-submit the same prompt through another account.
                        if provider_accepted or profile_bound:
                            raise
                        print(
                            f"[pool] {account} pre-submit timeout, rotating: {str(e)[:180]}",
                            flush=True,
                        )
                        last_err = e
                        continue
                    except VideoValidationError:
                        # A bad/mismatched file is a failed task, not a
                        # successful local credit claim.
                        raise
                    except PostSubmitCreditError as e:
                        # Dola accepted the conversation but explicitly
                        # reported insufficient credit while polling it. The
                        # provider cannot finish this conversation, so this is
                        # the one accepted-after-submit case that is safe to
                        # hand to the next profile. Each profile is visited at
                        # most once by this dispatch pass.
                        if stop_on_credit:
                            # The task scheduler owns a mode fallback for this
                            # request. Preserve the account/conversation binding
                            # so it can retry the same task on this profile.
                            raise
                        print(
                            f"[pool] {account} Dola rejected this request's credit cost; "
                            f"profile remains available for another mode: {str(e)[:180]}",
                            flush=True,
                        )
                        if on_account_rotation:
                            on_account_rotation(account, str(e))
                        last_err = e
                        continue
                    except PostSubmitAccountLimitError as e:
                        self._mark_daily_limit(account, str(e))
                        raise
                    except PreSubmitSetupError as e:
                        if isinstance(e, PreSubmitAttachmentSetupError):
                            if profile_bound and not attachment_recovery_attempted:
                                # The route guard saw stale attachments before
                                # Dola accepted the request. Reopen the same
                                # persistent profile once so its composer can
                                # be hard-reset; rotating here would replay
                                # the same image manifest into another profile.
                                attachment_recovery_attempted = True
                                print(
                                    f"[pool] {account} stale attachment payload; "
                                    "dọn composer và thử lại cùng profile một lần: "
                                    f"{str(e)[:180]}",
                                    flush=True,
                                )
                                continue
                            if profile_bound:
                                print(
                                    f"[pool] {account} stale attachment vẫn còn sau "
                                    "lần reset; giữ profile và dừng để tránh duplicate: "
                                    f"{str(e)[:180]}",
                                    flush=True,
                                )
                                raise
                        # Model/ratio/duration controls are rendered before
                        # the prompt is submitted. If one is temporarily
                        # missing after an image upload, no provider request
                        # exists yet, so rotate safely even though the profile
                        # was already bound to the composer input.
                        if (
                            isinstance(e, PreSubmitPromptSetupError)
                            and profile_bound
                        ):
                            # The prompt bridge failure happens after the
                            # image manifest has been assigned. Rotating here
                            # would replay the same images into another
                            # persistent composer and is the source of the
                            # "1 image becomes 5+" symptom. Keep the task on
                            # this profile and let the caller surface one
                            # actionable failure instead.
                            print(
                                f"[pool] {account} prompt setup failed after "
                                "profile binding; giữ profile, không upload lại: "
                                f"{str(e)[:180]}",
                                flush=True,
                            )
                            raise
                        print(
                            f"[pool] {account} pre-submit setup error, rotating: "
                            f"{str(e)[:180]}",
                            flush=True,
                        )
                        last_err = e
                        continue
                    except SessionExpiredError as e:
                        print(f"[pool] {account} session expired, disabling account: {e}", flush=True)
                        self.set_login_status(account, False)
                        self.set_scheduling(account, False)
                        if provider_accepted or (profile_bound and not relogin_attempted):
                            # The provider conversation is already durable;
                            # never submit the same prompt through another
                            # profile after this profile received its input.
                            raise
                        if relogin_attempted:
                            # The automatic relogin window has elapsed
                            # without a valid Dola session. This is still
                            # before provider acceptance, so rotate safely to
                            # the next profile instead of blocking the queue.
                            print(
                                f"[pool] {account} automatic relogin failed within "
                                f"{config.AUTO_RELOGIN_TIMEOUT_SEC}s; rotating to the next profile",
                                flush=True,
                            )
                        last_err = e
                        continue
                    except FileNotFoundError as e:
                        print(f"[pool] {account} profile missing, skipping: {e}", flush=True)
                        last_err = e
                        continue
                    except ImageLikenessRejectedError:
                        # Changing accounts cannot resolve a rejected reference image.
                        raise
                    except RuntimeError as e:
                        # UI/payload problems before Dola acknowledges a
                        # conversation are isolated to this profile (stale
                        # locale, delayed composer state, or a closed shell).
                        # Do not strand the whole batch at the first account;
                        # no provider conversation means no duplicate request
                        # and no local credit claim.
                        if provider_accepted:
                            raise
                        if profile_bound and _is_pre_submit_browser_closed(e):
                            print(
                                f"[pool] {account} pre-submit browser closed, rotating: "
                                f"{str(e)[:180]}",
                                flush=True,
                            )
                            last_err = e
                            continue
                        if profile_bound:
                            raise
                        print(
                            f"[pool] {account} pre-submit error, rotating: {str(e)[:180]}",
                            flush=True,
                        )
                        last_err = e
                        continue
                    except Exception as e:
                        # Patchright's page/context shutdown error is not
                        # consistently a built-in RuntimeError (depending on
                        # the Chromium driver version it can be an Error or a
                        # generic exception).  Match the stable message so a
                        # profile that closes before Dola acknowledges the
                        # conversation can rotate safely instead of ending the
                        # whole task with SUBMIT_FAILED.  Once the provider
                        # boundary is durable, preserve the error and never
                        # re-submit the same prompt.
                        if provider_accepted:
                            raise
                        if profile_bound and _is_pre_submit_browser_closed(e):
                            print(
                                f"[pool] {account} pre-submit browser closed, rotating: "
                                f"{str(e)[:180]}",
                                flush=True,
                            )
                            last_err = e
                            continue
                        raise
                    finally:
                        self._release_active_proxy(dispatch_proxy_id)

            if isinstance(last_err, SessionExpiredError):
                raise last_err
            if isinstance(last_err, CreditInsufficientError):
                raise last_err
            if isinstance(last_err, RateLimitError):
                raise RateLimitError(
                    "Dola rate limit: đã thử các profile khả dụng nhưng chưa tìm được profile nhận yêu cầu."
                ) from last_err
            if isinstance(last_err, RiskControlError):
                raise RiskControlError(
                    f"Dola risk-control: đã kiểm tra {risk_control_attempts} profile "
                    "trong lượt chạy này; lượt sau sẽ kiểm tra lại sau cooldown."
                ) from last_err
            if proxy_unavailable:
                raise AccountsBusyError(
                    "Các profile đủ điều kiện hiện đang chờ proxy được "
                    "ProxyFB xác nhận/đổi IP; tiếp tục thử lại"
                )
            if self.all_accounts_limited:
                raise AllAccountsLimitedError(
                    f"429: All schedulable accounts have reached Dola daily limit: {last_err or 'No accounts'}"
                )
            if busy:
                raise AccountsBusyError("All eligible account profiles are busy")
            risk_cooling = [
                item for item in accounts
                if item.get("cooldown_reason") == "risk_control"
            ]
            if risk_cooling:
                raise RiskControlError(
                    "Dola risk-control: tất cả profile còn lại đang tạm nghỉ; "
                    "lượt chạy này dừng và lượt sau sẽ kiểm tra lại sau cooldown."
                ) from last_err
            raise RuntimeError(f"No available accounts in pool: {last_err or 'No accounts'}")

    async def generate_video(self, prompt: str, ratio: str = None, duration: int = None,
                             model: str = "seedance_v2.5", on_conversation_id=None,
                             on_profile_bound=None, on_poll=None, on_balance=None,
                             reference_image_paths: list[str] | None = None,
                             on_timing=None, task_id: str | None = None,
                             preferred_account: str | None = None,
                             on_account_rotation=None, on_waiting=None,
                             excluded_accounts=None,
                             chat_mode: str | None = None,
                             stop_on_credit: bool = False,
                             on_account_attempt=None) -> dict:
        """Wait for an eligible profile; recovery may skip already-tried ones."""
        while True:
            try:
                return await self._generate_video_once(
                    prompt,
                    ratio,
                    duration,
                    model,
                    on_conversation_id,
                    on_profile_bound,
                    on_poll,
                    on_balance,
                    reference_image_paths,
                    on_timing,
                    task_id,
                    preferred_account,
                    on_account_rotation,
                    excluded_accounts,
                    chat_mode,
                    stop_on_credit,
                    on_account_attempt,
                )
            except AccountsBusyError:
                # Wake as soon as another task releases a profile. The
                # timeout prevents a missed event from stalling the queue.
                if on_waiting:
                    try:
                        on_waiting()
                    except Exception:
                        # Waiting-state telemetry must never interrupt the
                        # actual retry loop.
                        pass
                self._availability_event.clear()
                try:
                    await asyncio.wait_for(
                        self._availability_event.wait(),
                        timeout=config.ACCOUNT_WAIT_INTERVAL_SEC,
                    )
                except asyncio.TimeoutError:
                    pass
