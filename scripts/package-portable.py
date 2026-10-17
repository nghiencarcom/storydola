#!/usr/bin/env python3
"""Build a Windows ZIP for moving StoryAI-Dola to another computer."""
import os
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    ".npm-cache",
    "backups",
    "logs",
    "__pycache__",
    "release",
}


def should_skip(path: Path, include_data: bool = False) -> bool:
    relative = path.relative_to(ROOT)
    parts = relative.parts
    name = path.name
    lower = name.lower()

    if path.is_symlink():
        return True
    if any(part in SKIP_DIRS or part.startswith(".next") for part in parts):
        return True
    if name == ".DS_Store" or lower.startswith("dbg_") or lower == "dola-gateway.log":
        return True
    if lower.endswith((".zip", ".7z", ".rar")):
        return True
    if name.startswith(".env") and name != ".env.example":
        return True
    if lower.startswith("account_credentials.") or lower.endswith((".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite3", ".sqlite-shm", ".sqlite-wal", ".key", ".pem", ".p12", ".pfx", ".cookie", ".cookies", ".token", ".log")):
        return True
    if lower in {"cookies.txt", "storage_state.json", "storage-state.json"}:
        return True
    if len(parts) >= 2 and parts[0].lower() == "data" and parts[1].lower() in {"accounts", "profiles"}:
        return True
    if relative.as_posix().lower() in {"data/maivideo-api-keys.json", "data/seedance-accounts.json"}:
        return True
    if not include_data and relative.as_posix() != "data" and parts and parts[0] == "data" and relative.as_posix() != "data/.gitkeep":
        return True
    if parts[:3] == ("dola-studio", "dola-render-gateway", "accounts"):
        return True
    if parts[:3] == ("dola-studio", "dola-render-gateway", "downloads"):
        return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-data", action="store_true", help="include project metadata, scripts and generated media from data/")
    parser.add_argument("--output", type=Path, help="ZIP destination")
    args = parser.parse_args()

    files = []
    for current, directories, names in os.walk(ROOT, topdown=True):
        current_path = Path(current)
        directories[:] = sorted(name for name in directories if not should_skip(current_path / name, args.include_data))
        files.extend(
            current_path / name
            for name in names
            if not should_skip(current_path / name, args.include_data)
        )
    files.sort()
    output = (args.output.expanduser().resolve() if args.output else ROOT.parent / f"{ROOT.name}-Windows-Portable.zip")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, Path(ROOT.name) / path.relative_to(ROOT))
    mode = "đầy đủ dữ liệu dự án" if args.include_data else "chỉ mã nguồn"
    print(f"Đã tạo {output} ({len(files)} file, {mode}).")


if __name__ == "__main__":
    main()
