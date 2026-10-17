#!/usr/bin/env python3
"""Build a source-only Dola ZIP without local credentials or runtime data."""

from __future__ import annotations

import argparse
import hashlib
import stat
from datetime import datetime
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "Dola"

ROOT_FILES = (
    ".env.example",
    ".gitignore",
    "README.md",
    "HUONG_DAN_CAI_DAT_MAY_MOI.md",
    "eslint.config.mjs",
    "jsconfig.json",
    "next.config.mjs",
    "package.json",
    "package-lock.json",
)
ROOT_DIRS = ("app", "components", "lib", "public", "scripts")
GATEWAY_FILES = (
    ".gitignore",
    ".env.example",
    "README.md",
    "DEVELOPMENT.md",
    "requirements.txt",
    "start_server.sh",
    "start_server.ps1",
    "cookies.txt.example",
    "web/index.html",
)
GATEWAY_DIRS = (
    "extensions/SeedancePro",
    "extensions/dola30",
)
EXCLUDED_PARTS = {
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    "accounts",
    "downloads",
    "logs",
    "backups",
    "tests",
}
EXCLUDED_SUFFIXES = {
    ".db",
    ".db-journal",
    ".db-wal",
    ".db-shm",
    ".log",
    ".pyc",
    ".pem",
    ".key",
}


def excluded(relative_path: Path) -> bool:
    parts = relative_path.parts
    name = relative_path.name
    lower_name = name.lower()
    if any(part in EXCLUDED_PARTS for part in parts):
        return True
    if name.startswith(".env") and name != ".env.example":
        return True
    if lower_name.endswith(tuple(EXCLUDED_SUFFIXES)):
        return True
    if lower_name in {
        ".ds_store",
        "account_credentials.json",
        "cookies.txt",
        "dola-gateway.log",
        "dl_now.py",
    }:
        return True
    if lower_name.startswith(("dbg_", "debug_", "diagnostic-")):
        return True
    return False


def collect_files() -> list[Path]:
    candidates: set[Path] = set()
    for name in ROOT_FILES:
        candidates.add(Path(name))

    for directory in ROOT_DIRS:
        base = ROOT / directory
        candidates.update(path.relative_to(ROOT) for path in base.rglob("*"))

    gateway = ROOT / "dola-render-gateway"
    candidates.update(
        path.relative_to(ROOT)
        for path in gateway.iterdir()
        if path.is_file() and path.suffix == ".py"
    )
    for name in GATEWAY_FILES:
        candidates.add(Path("dola-render-gateway") / name)
    for directory in GATEWAY_DIRS:
        base = gateway / directory
        candidates.update(path.relative_to(ROOT) for path in base.rglob("*"))

    files = []
    for relative_path in candidates:
        source = ROOT / relative_path
        if (
            source.is_file()
            and not source.is_symlink()
            and not excluded(relative_path)
        ):
            files.append(relative_path)

    missing = [str(path) for path in candidates if not (ROOT / path).exists()]
    if missing:
        raise FileNotFoundError(
            "Required backup files are missing: " + ", ".join(sorted(missing))
        )
    return sorted(files, key=lambda path: path.as_posix())


def write_file(archive: ZipFile, relative_path: Path) -> None:
    source = ROOT / relative_path
    archive_name = PurePosixPath(ARCHIVE_ROOT, relative_path.as_posix()).as_posix()
    info = ZipInfo(archive_name)
    info.date_time = datetime.now().timetuple()[:6]
    info.create_system = 3
    mode = stat.S_IMODE(source.stat().st_mode)
    info.external_attr = (mode & 0xFFFF) << 16
    info.compress_type = ZIP_DEFLATED
    archive.writestr(
        info,
        source.read_bytes(),
        compress_type=ZIP_DEFLATED,
        compresslevel=6,
    )


def create_archive(output: Path) -> tuple[int, str]:
    files = collect_files()
    output.parent.mkdir(parents=True, exist_ok=True)
    created = datetime.now().astimezone().isoformat(timespec="seconds")
    manifest = [
        "Dola portable source backup",
        f"Created: {created}",
        f"Source: {ROOT.name}",
        "",
        "Included files:",
        *(f"- {path.as_posix()}" for path in files),
        "",
        "Excluded: credentials, environment files, cookies, browser profiles, databases,",
        "downloads, logs, virtual environments, node_modules, build caches, and Git history.",
    ]

    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for relative_path in files:
            write_file(archive, relative_path)
        info = ZipInfo(f"{ARCHIVE_ROOT}/BACKUP_MANIFEST.txt")
        info.date_time = datetime.now().timetuple()[:6]
        info.create_system = 3
        info.external_attr = (0o644 & 0xFFFF) << 16
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, "\n".join(manifest) + "\n")

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return len(files) + 1, digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        help="ZIP destination (default: backups/Dola-tool-backup-<timestamp>.zip)",
    )
    args = parser.parse_args()
    timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    output = args.output or (ROOT / "backups" / f"Dola-tool-backup-{timestamp}.zip")
    resolved_output = output.expanduser().resolve()
    count, digest = create_archive(resolved_output)
    print(f"Created: {resolved_output}")
    print(f"Files: {count}")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
