"""Task state persistence (SQLite) + API Key management with asyncio locks."""
import datetime
import hashlib
import json
import secrets
import sqlite3
import threading
import time

_LOCK = threading.Lock()
SUPPORTED_DURATIONS = (5, 10, 15, 30)
LEGACY_DEFAULT_ALLOWED_DURATIONS = "[10,15,30]"
DEFAULT_ALLOWED_DURATIONS = list(SUPPORTED_DURATIONS)
SQLITE_BUSY_TIMEOUT_MS = 30000


def _sqlite_is_locked(error: Exception) -> bool:
    message = str(error).lower()
    return "database is locked" in message or "database table is locked" in message


def _configure_sqlite_connection(conn: sqlite3.Connection):
    """Make task persistence safe for the API process and worker processes."""
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


class TaskQuotaExceeded(RuntimeError):
    """API Key reached daily task quota."""


class PendingTaskLimitExceeded(RuntimeError):
    """Server pending task queue is full."""


class TaskStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn = sqlite3.connect(
            db_path, timeout=SQLITE_BUSY_TIMEOUT_MS / 1000, check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        _configure_sqlite_connection(self._conn)
        self._init()

    def _init(self):
        with _LOCK:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    model TEXT,
                    prompt TEXT,
                    ratio TEXT,
                    duration INTEGER,
                    status TEXT,
                    video_url TEXT,
                    error TEXT,
                    created_at REAL,
                    updated_at REAL,
                    conversation_id TEXT,
                    deadline_at REAL,
                    last_poll_at REAL,
                    failure_code TEXT,
                    reference_images TEXT,
                    reference_image_names TEXT,
                    reference_image_mode TEXT DEFAULT 'none',
                    retry_of TEXT,
                    retry_count INTEGER DEFAULT 0,
                    last_retry_at REAL,
                    api_key_hash TEXT,
                    api_key_name TEXT,
                    owner_id TEXT,
                    started_at REAL,
                    finished_at REAL,
                    client_concurrency_limit INTEGER DEFAULT 0,
                    video_metadata TEXT,
                    timings_json TEXT
                )
                """
            )
            # Legacy migration: add missing columns for task recovery, client usage, and timing stats.
            for column, definition in (
                ("account", "TEXT"),
                ("conversation_id", "TEXT"),
                ("deadline_at", "REAL"),
                ("last_poll_at", "REAL"),
                ("failure_code", "TEXT"),
                ("reference_images", "TEXT"),
                ("reference_image_names", "TEXT"),
                ("reference_image_mode", "TEXT DEFAULT 'none'"),
                ("retry_of", "TEXT"),
                ("retry_count", "INTEGER DEFAULT 0"),
                ("last_retry_at", "REAL"),
                ("api_key_hash", "TEXT"),
                ("api_key_name", "TEXT"),
                ("owner_id", "TEXT"),
                ("started_at", "REAL"),
                ("finished_at", "REAL"),
                ("client_concurrency_limit", "INTEGER DEFAULT 0"),
                ("video_metadata", "TEXT"),
                ("timings_json", "TEXT"),
            ):
                try:
                    self._conn.execute(f"ALTER TABLE tasks ADD COLUMN {column} {definition}")
                except sqlite3.OperationalError:
                    pass
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_keys (
                    key TEXT PRIMARY KEY,
                    name TEXT,
                    enabled INTEGER DEFAULT 1,
                    created_at REAL,
                    last_used_at REAL DEFAULT 0,
                    daily_limit INTEGER DEFAULT 0,
                    concurrency_limit INTEGER DEFAULT 0,
                    allowed_durations TEXT DEFAULT '[5, 10, 15]',
                    expires_at REAL DEFAULT 0,
                    owner_id TEXT DEFAULT ''
                )
                """
            )
            # Legacy migration: add client-level policy columns to existing API Keys.
            for column, definition in (
                ("daily_limit", "INTEGER DEFAULT 0"),
                ("concurrency_limit", "INTEGER DEFAULT 0"),
                ("allowed_durations", "TEXT DEFAULT '[5, 10, 15]'"),
                ("expires_at", "REAL DEFAULT 0"),
                ("owner_id", "TEXT DEFAULT ''"),
            ):
                try:
                    self._conn.execute(f"ALTER TABLE api_keys ADD COLUMN {column} {definition}")
                except sqlite3.OperationalError:
                    pass
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_api_keys_owner_created "
                "ON api_keys(owner_id, created_at DESC)"
            )
            # Queue reads are ordered by creation time and are normally scoped
            # to one MaiVideo owner. These indexes avoid a full table scan and
            # temporary sort for every queue refresh as task history grows.
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_created_id "
                "ON tasks(created_at DESC, id DESC)"
            )
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_owner_created_id "
                "ON tasks(owner_id, created_at DESC, id DESC)"
            )
            # Existing keys created with the former all-duration default should
            # keep access to every currently supported duration. Custom key
            # policies remain unchanged apart from the normal unsupported-value
            # filtering performed by _parse_allowed_durations.
            self._conn.execute(
                "UPDATE api_keys SET allowed_durations=? "
                "WHERE replace(allowed_durations, ' ', '') IN (?, ?)",
                (
                    json.dumps(DEFAULT_ALLOWED_DURATIONS, ensure_ascii=False),
                    LEGACY_DEFAULT_ALLOWED_DURATIONS,
                    "[5,10,30]",
                ),
            )
            self._conn.commit()

    @staticmethod
    def hash_api_key(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_allowed_durations(raw) -> list[int]:
        if isinstance(raw, list):
            values = raw
        else:
            try:
                values = json.loads(raw or "[]")
            except (TypeError, json.JSONDecodeError):
                values = []
        result = set()
        for value in values if isinstance(values, list) else []:
            try:
                value = int(value)
            except (TypeError, ValueError):
                continue
            if value in SUPPORTED_DURATIONS:
                result.add(value)
        return sorted(result) or list(DEFAULT_ALLOWED_DURATIONS)

    @classmethod
    def _key_row(cls, row):
        if not row:
            return None
        data = dict(row)
        data["enabled"] = bool(data.get("enabled"))
        data["allowed_durations"] = cls._parse_allowed_durations(data.get("allowed_durations"))
        data["daily_limit"] = max(0, int(data.get("daily_limit") or 0))
        data["concurrency_limit"] = max(0, int(data.get("concurrency_limit") or 0))
        data["expires_at"] = float(data.get("expires_at") or 0)
        return data

    # ===== tasks =====

    def create(
        self,
        task_id,
        model,
        prompt,
        ratio,
        duration,
        account=None,
        reference_images=None,
        reference_image_names=None,
        reference_image_mode="none",
        retry_of=None,
        retry_count=0,
        api_key_hash=None,
        api_key_name=None,
        daily_limit=0,
        concurrency_limit=0,
        max_pending=0,
        owner_id=None,
    ):
        now = time.time()
        with _LOCK:
            if max_pending > 0:
                pending = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE status IN ('queued','submitting','processing')"
                ).fetchone()[0]
                if pending >= max_pending:
                    raise PendingTaskLimitExceeded(
                        f"Pending task queue has reached server limit ({max_pending})"
                    )
            if daily_limit > 0 and api_key_hash:
                day = datetime.date.today().isoformat()
                used = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks "
                    "WHERE api_key_hash=? AND date(created_at,'unixepoch','localtime')=?",
                    (api_key_hash, day),
                ).fetchone()[0]
                if used >= daily_limit:
                    raise TaskQuotaExceeded(
                        f"API Key daily quota exceeded ({daily_limit} tasks)"
                    )
            self._conn.execute(
                "INSERT INTO tasks ("
                "id,model,prompt,ratio,duration,status,account,created_at,updated_at,"
                "conversation_id,deadline_at,last_poll_at,failure_code,reference_images,reference_image_names,"
                "reference_image_mode,"
                "retry_of,retry_count,"
                "api_key_hash,api_key_name,started_at,finished_at,client_concurrency_limit,owner_id"
                ") VALUES (?,?,?,?,?,'queued',?,?,?,NULL,NULL,0,NULL,?,?,?,?,?,?,?, ?,?,?,?)",
                (
                    task_id,
                    model,
                    prompt,
                    ratio,
                    duration,
                    account,
                    now,
                    now,
                    reference_images or "[]",
                    reference_image_names or "[]",
                    str(reference_image_mode or "none"),
                    retry_of,
                    max(0, int(retry_count or 0)),
                    api_key_hash,
                    api_key_name,
                    None,
                    None,
                    max(0, int(concurrency_limit or 0)),
                    owner_id,
                ),
            )
            self._conn.commit()

    def update(self, task_id, **fields):
        if not fields:
            return
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [task_id]
        with _LOCK:
            self._conn.execute(f"UPDATE tasks SET {cols} WHERE id=?", vals)
            self._conn.commit()

    def cancel_tasks(self, task_ids: list[str], error: str = "Task đã bị huỷ bởi người dùng") -> list:
        """Mark active tasks as cancelled before their runtime workers stop.

        The status transition is durable so a task cancelled while it is
        between poll windows cannot be recovered and submitted again after a
        Gateway restart. The caller can then stop the in-memory worker and
        remove the rows with ``delete_tasks``.
        """
        normalized = []
        seen = set()
        for raw_id in task_ids or []:
            task_id = str(raw_id).strip()
            if task_id and task_id not in seen:
                normalized.append(task_id)
                seen.add(task_id)
        if not normalized:
            return []

        placeholders = ",".join("?" for _ in normalized)
        active_clause = "status IN ('queued','submitting','processing')"
        now = time.time()
        with _LOCK:
            rows = self._conn.execute(
                f"SELECT * FROM tasks WHERE id IN ({placeholders}) AND {active_clause}",
                normalized,
            ).fetchall()
            if rows:
                self._conn.execute(
                    f"UPDATE tasks SET status='cancelled', error=?, failure_code='CANCELLED', "
                    f"finished_at=?, updated_at=? WHERE id IN ({placeholders}) AND {active_clause}",
                    [error[:500], now, now, *normalized],
                )
                self._conn.commit()
        return [dict(row) for row in rows]

    def resume_failed_poll(self, task_id, account, conversation_id, deadline_at):
        """Atomically reclaim a failed accepted conversation without resubmission."""
        with _LOCK:
            result = self._conn.execute(
                "UPDATE tasks SET status='processing', error=NULL, failure_code=NULL, "
                "finished_at=NULL, deadline_at=?, updated_at=? "
                "WHERE id=? AND status='failed' AND account=? AND conversation_id=? "
                "AND video_url IS NULL AND (failure_code IS NULL OR failure_code IN "
                "('POLL_FAILED','RENDER_TIMEOUT','AUTH_EXPIRED','VIDEO_DOWNLOAD_FAILED'))",
                (deadline_at, time.time(), task_id, account, conversation_id),
            )
            self._conn.commit()
            if result.rowcount != 1:
                return None
            return dict(self._conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())

    def requeue_failed(
        self,
        task_id,
        api_key_hash: str | None,
        daily_limit=0,
        max_pending=0,
        owner_id=None,
    ):
        """Requeue one failed logical task without creating a second row.

        The provider conversation is intentionally cleared. The worker will
        create a fresh provider conversation for the next attempt, while the
        durable dashboard task keeps its id and retry counter.
        """
        task_id = str(task_id or "").strip()
        if not task_id:
            return None

        with _LOCK:
            if owner_id:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND owner_id=?",
                    (task_id, owner_id),
                ).fetchone()
            elif api_key_hash:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND api_key_hash=?",
                    (task_id, api_key_hash),
                ).fetchone()
            else:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND api_key_hash IS NULL",
                    (task_id,),
                ).fetchone()
            if not row:
                return None
            if row["status"] != "failed":
                raise RuntimeError("Only failed tasks can be retried")

            if max_pending > 0:
                pending = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE status IN ('queued','submitting','processing')"
                ).fetchone()[0]
                if pending >= max_pending:
                    raise PendingTaskLimitExceeded(
                        f"Pending task queue has reached server limit ({max_pending})"
                    )

            if daily_limit > 0 and api_key_hash:
                day = datetime.date.today().isoformat()
                used = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks "
                    "WHERE api_key_hash=? AND date(created_at,'unixepoch','localtime')=?",
                    (api_key_hash, day),
                ).fetchone()[0]
                if used >= daily_limit:
                    raise TaskQuotaExceeded(
                        f"API Key daily quota exceeded ({daily_limit} tasks)"
                    )

            now = time.time()
            retry_count = max(0, int(row["retry_count"] or 0)) + 1
            self._conn.execute(
                "UPDATE tasks SET status='queued', account=NULL, "
                "video_url=NULL, error=NULL, conversation_id=NULL, deadline_at=NULL, "
                "last_poll_at=0, failure_code=NULL, started_at=NULL, finished_at=NULL, "
                "video_metadata=NULL, timings_json=NULL, retry_count=?, last_retry_at=?, "
                "updated_at=? WHERE id=? AND status='failed'",
                (retry_count, now, now, task_id),
            )
            self._conn.commit()
            updated = self._conn.execute(
                "SELECT * FROM tasks WHERE id=?", (task_id,)
            ).fetchone()
        return dict(updated) if updated else None

    def create_many(self, tasks: list[dict], max_pending=0, daily_limit=0,
                    api_key_hash=None, owner_id=None):
        """Atomically admit a batch of queued tasks.

        The UI can submit one request for an entire batch instead of opening a
        network request for every prompt. Validation and quota checks happen
        once, while each task still gets its own durable row and worker.
        """
        rows = [item for item in (tasks or []) if isinstance(item, dict)]
        if not rows:
            return
        now = time.time()
        with _LOCK:
            if max_pending > 0:
                pending = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE status IN ('queued','submitting','processing')"
                ).fetchone()[0]
                if pending + len(rows) > max_pending:
                    raise PendingTaskLimitExceeded(
                        f"Pending task queue has reached server limit ({max_pending}); "
                        f"remaining capacity is {max(0, max_pending - pending)}"
                    )
            if daily_limit > 0 and api_key_hash:
                day = datetime.date.today().isoformat()
                used = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks "
                    "WHERE api_key_hash=? AND date(created_at,'unixepoch','localtime')=?",
                    (api_key_hash, day),
                ).fetchone()[0]
                if used + len(rows) > daily_limit:
                    raise TaskQuotaExceeded(
                        f"API Key daily quota exceeded ({daily_limit} tasks)"
                    )

            values = []
            for item in rows:
                created_at = float(item.get("created_at") or now)
                values.append((
                    item["id"], item["model"], item["prompt"], item.get("ratio"),
                    item["duration"], item.get("account"), created_at, created_at,
                    item.get("reference_images") or "[]",
                    item.get("reference_image_names") or "[]",
                    item.get("reference_image_mode") or "none",
                    item.get("retry_of"),
                    max(0, int(item.get("retry_count") or 0)),
                    item.get("api_key_hash", api_key_hash),
                    item.get("api_key_name"), None, None,
                    max(0, int(item.get("client_concurrency_limit") or 0)),
                    item.get("owner_id", owner_id),
                ))
            try:
                self._conn.executemany(
                    "INSERT INTO tasks ("
                    "id,model,prompt,ratio,duration,status,account,created_at,updated_at,"
                    "conversation_id,deadline_at,last_poll_at,failure_code,reference_images,reference_image_names,"
                    "reference_image_mode,"
                    "retry_of,retry_count,api_key_hash,api_key_name,started_at,finished_at,"
                    "client_concurrency_limit,owner_id"
                    ") VALUES (?,?,?,?,?,'queued',?,?,?,NULL,NULL,0,NULL,?,?,?,?,?,?,?, ?,?,?,?)",
                    values,
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def get(self, task_id):
        with _LOCK:
            row = self._conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None

    def get_for_client(self, task_id, api_key_hash: str | None, owner_id=None):
        """Returns a task scoped to the MaiVideo owner, then API Key fallback."""
        with _LOCK:
            if owner_id:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND owner_id=?",
                    (task_id, owner_id),
                ).fetchone()
            elif api_key_hash:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND api_key_hash=?",
                    (task_id, api_key_hash),
                ).fetchone()
            else:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE id=? AND api_key_hash IS NULL",
                    (task_id,),
                ).fetchone()
        return dict(row) if row else None

    def recoverable_tasks(self) -> list:
        """Recovers tasks with existing conversation_id after restart without re-submitting prompt."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT * FROM tasks WHERE status IN ('queued','submitting','processing') "
                "AND conversation_id IS NOT NULL AND account IS NOT NULL "
                "ORDER BY created_at"
            ).fetchall()
        return [dict(r) for r in rows]

    def migrate_video_poll_deadlines(self, legacy_max_wait_sec: int,
                                     new_max_wait_sec: int) -> list[str]:
        """Extend accepted-conversation deadlines once when the max wait grows.

        Older Gateway builds capped a configured 30-minute wait at 20 minutes.
        Preserve the original conversation start time by extending its durable
        deadline by only the difference. The marker in timings_json prevents a
        later restart from extending the same conversation a second time.
        """
        legacy_max = max(1, int(legacy_max_wait_sec))
        new_max = max(legacy_max, int(new_max_wait_sec))
        if new_max <= legacy_max:
            return []

        migrated = []
        extension = new_max - legacy_max
        migration_cutoff = time.time() - extension
        with _LOCK:
            rows = self._conn.execute(
                "SELECT id,deadline_at,timings_json FROM tasks "
                "WHERE account IS NOT NULL AND conversation_id IS NOT NULL "
                "AND video_url IS NULL AND deadline_at>? AND ("
                "status IN ('queued','submitting','processing') OR "
                "(status='failed' AND (failure_code IN ('RENDER_TIMEOUT','POLL_FAILED') "
                "OR failure_code IS NULL)))",
                (migration_cutoff,),
            ).fetchall()
            for row in rows:
                try:
                    timings = json.loads(row["timings_json"] or "{}")
                except (TypeError, ValueError):
                    timings = {}
                if not isinstance(timings, dict):
                    timings = {}
                try:
                    recorded_max = max(
                        1, int(timings.get("conversation_poll_max_wait_sec") or legacy_max)
                    )
                except (TypeError, ValueError):
                    recorded_max = legacy_max
                if recorded_max >= new_max:
                    continue
                extension = new_max - recorded_max
                timings["conversation_poll_max_wait_sec"] = new_max
                self._conn.execute(
                    "UPDATE tasks SET deadline_at=?,timings_json=? WHERE id=?",
                    (
                        float(row["deadline_at"]) + extension,
                        json.dumps(timings, ensure_ascii=False),
                        row["id"],
                    ),
                )
                migrated.append(row["id"])
            if migrated:
                self._conn.commit()
        return migrated

    def recoverable_failed_poll_tasks(self) -> list:
        """Returns failed tasks whose accepted provider conversation can still be polled.

        A browser/context failure after acceptance must not discard the only
        provider conversation id. Keep only poll/timeout failures with an
        unexpired durable deadline; explicit credit, auth, output and risk
        failures remain terminal and require an operator action.
        """
        now = time.time()
        with _LOCK:
            rows = self._conn.execute(
                "SELECT * FROM tasks WHERE status='failed' "
                "AND video_url IS NULL AND conversation_id IS NOT NULL "
                "AND (failure_code IN ('RENDER_TIMEOUT','POLL_FAILED') "
                "OR failure_code IS NULL) "
                "AND (deadline_at IS NULL OR deadline_at > ?) "
                "ORDER BY updated_at",
                (now,),
            ).fetchall()
        return [dict(r) for r in rows]

    def recoverable_queued_tasks(self) -> list:
        """Recovers queued tasks without conversation_id after restart."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT * FROM tasks WHERE status IN ('queued','submitting','processing') "
                "AND conversation_id IS NULL ORDER BY created_at"
            ).fetchall()
        return [dict(r) for r in rows]

    def pending_task_count(self) -> int:
        with _LOCK:
            return self._conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE status IN ('queued','submitting','processing')"
            ).fetchone()[0]

    def count_tasks(self, api_key_hash: str | None = None, owner_id=None) -> int:
        with _LOCK:
            if owner_id:
                row = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE owner_id=?",
                    (owner_id,),
                ).fetchone()
            elif api_key_hash:
                row = self._conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE api_key_hash=?",
                    (api_key_hash,),
                ).fetchone()
            else:
                row = self._conn.execute("SELECT COUNT(*) FROM tasks").fetchone()
        return int(row[0] or 0)

    def recent_tasks(
        self,
        limit: int = 50,
        api_key_hash: str | None = None,
        owner_id=None,
        offset: int = 0,
    ) -> list:
        limit = max(1, int(limit))
        offset = max(0, int(offset))
        with _LOCK:
            if owner_id:
                rows = self._conn.execute(
                    "SELECT * FROM tasks WHERE owner_id=? "
                    "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (owner_id, limit, offset),
                ).fetchall()
            elif api_key_hash:
                rows = self._conn.execute(
                    "SELECT * FROM tasks WHERE api_key_hash=? "
                    "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (api_key_hash, limit, offset),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
        return [dict(r) for r in rows]

    def recent_queue_tasks(
        self,
        limit: int = 50,
        owner_id=None,
        offset: int = 0,
    ) -> list:
        """Return only fields consumed by the Studio render queue."""
        limit = max(1, int(limit))
        offset = max(0, int(offset))
        columns = (
            "id,model,prompt,ratio,duration,status,video_url,error,created_at,updated_at,"
            "conversation_id,failure_code,reference_images,reference_image_names,"
            "reference_image_mode,retry_of,retry_count,last_retry_at,account,started_at,"
            "finished_at,video_metadata,timings_json,owner_id"
        )
        with _LOCK:
            if owner_id:
                rows = self._conn.execute(
                    f"SELECT {columns} FROM tasks WHERE owner_id=? "
                    "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                    (owner_id, limit, offset),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    f"SELECT {columns} FROM tasks "
                    "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
        return [dict(row) for row in rows]

    def task_owner_summaries(self) -> list[dict]:
        """Return aggregate owner IDs for the admin queue filter, never task data."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT owner_id, COUNT(*) AS task_count "
                "FROM tasks WHERE owner_id IS NOT NULL AND owner_id<>'' "
                "GROUP BY owner_id ORDER BY task_count DESC, owner_id ASC"
            ).fetchall()
        return [
            {"owner_id": str(row["owner_id"]), "count": int(row["task_count"] or 0)}
            for row in rows
        ]

    def tasks_by_ids(self, task_ids: list[str], api_key_hash: str | None = None, owner_id=None) -> list:
        normalized = []
        seen = set()
        for raw_id in task_ids or []:
            task_id = str(raw_id).strip()
            if task_id and task_id not in seen:
                normalized.append(task_id)
                seen.add(task_id)
        if not normalized:
            return []

        placeholders = ",".join("?" for _ in normalized)
        scope_clause = ""
        scope_params = []
        if owner_id:
            scope_clause = " AND owner_id=?"
            scope_params.append(owner_id)
        elif api_key_hash:
            scope_clause = " AND api_key_hash=?"
            scope_params.append(api_key_hash)
        with _LOCK:
            rows = self._conn.execute(
                f"SELECT * FROM tasks WHERE id IN ({placeholders}){scope_clause}",
                [*normalized, *scope_params],
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_tasks(self, task_ids: list[str], exclude_statuses: set[str] | None = None) -> list:
        """Delete task rows and return the rows that were removed.

        The caller uses the returned video URLs to remove files from the
        download directory. Keeping the database mutation in one transaction
        prevents the dashboard from observing a half-deleted selection. A
        protected status set can be supplied so a task that starts rendering
        between the initial read and this mutation is still kept safe.
        """
        normalized = []
        seen = set()
        for raw_id in task_ids or []:
            task_id = str(raw_id).strip()
            if task_id and task_id not in seen:
                normalized.append(task_id)
                seen.add(task_id)
        if not normalized:
            return []

        placeholders = ",".join("?" for _ in normalized)
        protected = {
            str(status).strip() for status in (exclude_statuses or set())
            if str(status).strip()
        }
        status_clause = ""
        status_params = []
        if protected:
            status_placeholders = ",".join("?" for _ in protected)
            status_clause = f" AND status NOT IN ({status_placeholders})"
            status_params = sorted(protected)
        with _LOCK:
            rows = self._conn.execute(
                f"SELECT * FROM tasks WHERE id IN ({placeholders}){status_clause}",
                [*normalized, *status_params]
            ).fetchall()
            if rows:
                self._conn.execute(
                    f"DELETE FROM tasks WHERE id IN ({placeholders}){status_clause}",
                    [*normalized, *status_params]
                )
                self._conn.commit()
        return [dict(row) for row in rows]

    def key_usage(self, api_key_hash: str, day: str | None = None) -> dict:
        day = day or datetime.date.today().isoformat()
        with _LOCK:
            row = self._conn.execute(
                "SELECT COUNT(*) AS total, "
                "SUM(status='completed') AS completed, "
                "SUM(status='failed') AS failed, "
                "SUM(status IN ('submitting','processing')) AS active, "
                "SUM(status='queued') AS queued "
                "FROM tasks WHERE api_key_hash=? "
                "AND date(created_at,'unixepoch','localtime')=?",
                (api_key_hash, day),
            ).fetchone()
        return {
            "day": day,
            "total": row["total"] or 0,
            "completed": row["completed"] or 0,
            "failed": row["failed"] or 0,
            "active": row["active"] or 0,
            "queued": row["queued"] or 0,
        }

    def stats(self) -> dict:
        """Daily completed/failed stats, success rate, 7-day trend, and total generated per account."""
        days = [(datetime.date.today() - datetime.timedelta(days=i)).isoformat()
                for i in range(6, -1, -1)]
        with _LOCK:
            per_day = []
            for d in days:
                row = self._conn.execute(
                    "SELECT sum(status='completed'), sum(status='failed') FROM tasks "
                    "WHERE date(created_at,'unixepoch','localtime')=?", (d,),
                ).fetchone()
                per_day.append({"day": d[5:], "completed": row[0] or 0, "failed": row[1] or 0})
            t = per_day[-1]
            per_account = self._conn.execute(
                "SELECT account, sum(status='completed') FROM tasks "
                "WHERE account IS NOT NULL GROUP BY account"
            ).fetchall()
        completed, failed = t["completed"], t["failed"]
        total = completed + failed
        return {
            "today_completed": completed,
            "today_failed": failed,
            "success_rate": round(completed / total, 3) if total else None,
            "per_day": per_day,
            "per_account_total": {r[0]: r[1] for r in per_account},
        }

    def account_usage(self, account: str, day: str | None = None) -> dict:
        """Return download/task counters for one logical render account.

        A task is marked ``completed`` only after the worker has downloaded
        and validated the provider's video.  Counting completed tasks therefore
        gives the same meaning as BrowserPool's ``used_today`` counter while
        also making every render account observable in the dashboard.
        """
        account = str(account or "").strip()
        day = str(day or datetime.date.today().isoformat())
        empty = {
            "used_today": 0,
            "downloaded_today": 0,
            "completed_today": 0,
            "failed_today": 0,
            "active_tasks": 0,
            "queued_tasks": 0,
            "downloaded_total": 0,
            "completed_total": 0,
            "failed_total": 0,
            "last_download_at": 0,
        }
        if not account:
            return empty
        with _LOCK:
            today = self._conn.execute(
                "SELECT "
                "SUM(status='completed' AND date(created_at,'unixepoch','localtime')=?) AS completed_today, "
                "SUM(status='failed' AND date(created_at,'unixepoch','localtime')=?) AS failed_today, "
                "SUM(status IN ('submitting','processing')) AS active_tasks, "
                "SUM(status='queued') AS queued_tasks "
                "FROM tasks WHERE account=?",
                (day, day, account),
            ).fetchone()
            lifetime = self._conn.execute(
                "SELECT "
                "SUM(status='completed') AS completed_total, "
                "SUM(status='failed') AS failed_total, "
                "MAX(CASE WHEN status='completed' THEN finished_at ELSE 0 END) AS last_download_at "
                "FROM tasks WHERE account=?",
                (account,),
            ).fetchone()
        completed_today = int((today["completed_today"] if today else 0) or 0)
        failed_today = int((today["failed_today"] if today else 0) or 0)
        active_tasks = int((today["active_tasks"] if today else 0) or 0)
        queued_tasks = int((today["queued_tasks"] if today else 0) or 0)
        completed_total = int((lifetime["completed_total"] if lifetime else 0) or 0)
        failed_total = int((lifetime["failed_total"] if lifetime else 0) or 0)
        last_download_at = float((lifetime["last_download_at"] if lifetime else 0) or 0)
        return {
            "used_today": completed_today,
            "downloaded_today": completed_today,
            "completed_today": completed_today,
            "failed_today": failed_today,
            "active_tasks": active_tasks,
            "queued_tasks": queued_tasks,
            "downloaded_total": completed_total,
            "completed_total": completed_total,
            "failed_total": failed_total,
            "last_download_at": last_download_at,
        }

    # ===== api keys =====

    def list_keys(self) -> list:
        with _LOCK:
            rows = self._conn.execute(
                "SELECT * FROM api_keys ORDER BY created_at DESC"
            ).fetchall()
        return [self._key_row(r) for r in rows]

    def list_user_keys(self, owner_id: str) -> list:
        """List safe metadata for one user's keys without returning secrets."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT * FROM api_keys WHERE owner_id=? ORDER BY created_at DESC",
                (owner_id,),
            ).fetchall()
        result = []
        for row in rows:
            data = self._key_row(row)
            raw_key = str(data.pop("key", ""))
            data.pop("owner_id", None)
            data["key_id"] = self.hash_api_key(raw_key)
            data["masked_key"] = (
                f"{raw_key[:7]}…{raw_key[-4:]}" if len(raw_key) >= 12 else "••••"
            )
            result.append(data)
        return result

    def get_user_key_secret(self, owner_id: str, key_id: str) -> str | None:
        """Return an active key only when its non-secret ID belongs to the owner."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT key FROM api_keys WHERE owner_id=? AND enabled=1 "
                "AND (expires_at=0 OR expires_at>?)",
                (owner_id, time.time()),
            ).fetchall()
        return next(
            (str(row[0]) for row in rows
             if self.hash_api_key(str(row[0])) == str(key_id)),
            None,
        )

    def ensure_user_key(self, owner_id: str, name: str = "Seedance API") -> dict | None:
        """Atomically create a user's first personal key, without recreating revoked keys."""
        now = time.time()
        with _LOCK:
            existing = self._conn.execute(
                "SELECT 1 FROM api_keys WHERE owner_id=? LIMIT 1",
                (owner_id,),
            ).fetchone()
            if existing:
                return None

            key = "sk-" + secrets.token_hex(16)
            allowed = json.dumps(list(SUPPORTED_DURATIONS), ensure_ascii=False)
            self._conn.execute(
                "INSERT INTO api_keys (key,name,enabled,created_at,last_used_at,"
                "daily_limit,concurrency_limit,allowed_durations,expires_at,owner_id) "
                "VALUES (?,?,1,?,0,0,0,?,0,?)",
                (key, name or "Seedance API", now, allowed, owner_id),
            )
            row = self._conn.execute(
                "SELECT * FROM api_keys WHERE key=?", (key,)
            ).fetchone()
            self._conn.commit()

        data = self._key_row(row)
        data["last_used_at"] = 0
        data["key"] = key
        return data

    def get_key(self, key: str) -> dict | None:
        with _LOCK:
            row = self._conn.execute(
                "SELECT * FROM api_keys WHERE key=?", (key,)
            ).fetchone()
        return self._key_row(row)

    def create_key(
        self,
        name: str,
        daily_limit: int = 0,
        concurrency_limit: int = 0,
        allowed_durations: list[int] | None = None,
        expires_at: float | None = None,
        owner_id: str | None = None,
    ) -> dict:
        key = "sk-" + secrets.token_hex(16)
        now = time.time()
        allowed = self._parse_allowed_durations(allowed_durations or DEFAULT_ALLOWED_DURATIONS)
        expires = float(expires_at or 0)
        with _LOCK:
            if owner_id:
                active = self._conn.execute(
                    "SELECT COUNT(*) FROM api_keys WHERE owner_id=? AND enabled=1 "
                    "AND (expires_at=0 OR expires_at>?)",
                    (owner_id, now),
                ).fetchone()[0]
                if int(active or 0) >= 1:
                    raise ValueError("Mỗi tài khoản chỉ được có 1 API key đang hoạt động. Hãy thu hồi key hiện tại trước khi tạo key thay thế.")
            self._conn.execute(
                "INSERT INTO api_keys (key,name,enabled,created_at,last_used_at,"
                "daily_limit,concurrency_limit,allowed_durations,expires_at,owner_id) "
                "VALUES (?,?,1,?,0,?,?,?,?,?)",
                (
                    key,
                    name or "",
                    now,
                    max(0, int(daily_limit or 0)),
                    max(0, int(concurrency_limit or 0)),
                    json.dumps(allowed, ensure_ascii=False),
                    expires,
                    owner_id or "",
                ),
            )
            self._conn.commit()
        data = self.get_key(key)
        data["last_used_at"] = 0
        data["key"] = key
        return data

    def delete_user_key(self, owner_id: str, key_id: str) -> bool:
        """Revoke a user's key by its non-secret SHA-256 identifier."""
        with _LOCK:
            rows = self._conn.execute(
                "SELECT key FROM api_keys WHERE owner_id=?", (owner_id,)
            ).fetchall()
            key = next(
                (str(row[0]) for row in rows
                 if self.hash_api_key(str(row[0])) == str(key_id)),
                None,
            )
            if not key:
                return False
            self._conn.execute(
                "UPDATE api_keys SET enabled=0 WHERE key=? AND owner_id=?",
                (key, owner_id),
            )
            self._conn.commit()
        return True

    def update_key(self, key: str, **fields):
        if not fields:
            return
        fields = dict(fields)
        if "allowed_durations" in fields:
            fields["allowed_durations"] = json.dumps(
                self._parse_allowed_durations(fields["allowed_durations"]),
                ensure_ascii=False,
            )
        cols = ", ".join(f"{k}=?" for k in fields)
        with _LOCK:
            self._conn.execute(
                f"UPDATE api_keys SET {cols} WHERE key=?",
                list(fields.values()) + [key],
            )
            self._conn.commit()

    def delete_key(self, key: str):
        with _LOCK:
            self._conn.execute("DELETE FROM api_keys WHERE key=?", (key,))
            self._conn.commit()

    def has_enabled_keys(self) -> bool:
        with _LOCK:
            row = self._conn.execute(
                "SELECT 1 FROM api_keys WHERE enabled=1 LIMIT 1"
            ).fetchone()
        return bool(row)

    def has_user_keys(self) -> bool:
        """Keep auth enabled after a personal key is revoked, without changing legacy admin-key behavior."""
        with _LOCK:
            row = self._conn.execute(
                "SELECT 1 FROM api_keys WHERE owner_id IS NOT NULL AND owner_id<>'' LIMIT 1"
            ).fetchone()
        return bool(row)

    def is_key_valid(self, key: str) -> bool:
        with _LOCK:
            row = self._conn.execute(
                "SELECT enabled, expires_at FROM api_keys WHERE key=?", (key,)
            ).fetchone()
        if not row or not row["enabled"]:
            return False
        return not row["expires_at"] or row["expires_at"] > time.time()

    def touch_key(self, key: str, min_interval: float = 60):
        """Throttled update of last_used_at."""
        now = time.time()
        with _LOCK:
            row = self._conn.execute(
                "SELECT last_used_at FROM api_keys WHERE key=?", (key,)
            ).fetchone()
            if row and now - (row[0] or 0) >= min_interval:
                self._conn.execute(
                    "UPDATE api_keys SET last_used_at=? WHERE key=?", (now, key)
                )
                self._conn.commit()
