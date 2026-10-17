#!/usr/bin/env python3
"""Create an overlay ZIP containing only changed files between two Windows bundles."""

from __future__ import annotations

import argparse
import filecmp
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def is_preserved(relative_path: str) -> bool:
    parts = relative_path.replace("\\", "/").split("/")
    segments = [part.lower() for part in parts]
    leaf = segments[-1]
    if segments[0] == "data":
        return True
    if any(part in {"node_modules", "runtime", ".venv", "venv", "browsers"} for part in segments):
        return True
    if any(part in {"accounts", "profiles", "downloads", "logs"} for part in segments):
        return True
    if leaf.startswith(".env") and leaf != ".env.example":
        return True
    if leaf.startswith("account_credentials."):
        return True
    if leaf.endswith((".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite-shm", ".sqlite-wal", ".sqlite3", ".sqlite3-shm", ".sqlite3-wal")):
        return True
    return leaf in {"cookies.txt", "storage_state.json", "storage-state.json", "dola-gateway.log"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path, help="Existing Windows bundle to update")
    parser.add_argument("--target", required=True, type=Path, help="New Windows bundle")
    parser.add_argument("--output", required=True, type=Path, help="Output patch ZIP")
    args = parser.parse_args()

    base = args.base.resolve(strict=True)
    target = args.target.resolve(strict=True)
    output = args.output.resolve()
    if not base.is_dir() or not target.is_dir():
        parser.error("--base and --target must be directories")
    if base == target or base in output.parents or target in output.parents:
        parser.error("output must be outside both input bundles")

    changed: list[Path] = []
    for root, directories, filenames in os.walk(target):
        directories.sort()
        for filename in sorted(filenames):
            source = Path(root, filename)
            relative = source.relative_to(target)
            relative_posix = relative.as_posix()
            if is_preserved(relative_posix):
                continue
            old = base / relative
            # Identical copied dependencies retain their source size and mtime,
            # so the shallow check avoids reading gigabytes of runtime files.
            if not old.is_file() or not filecmp.cmp(source, old, shallow=True):
                changed.append(source)

    # The existing installer validates a portable ZIP by finding this launcher.
    # Include its metadata even when the launcher binary is byte-identical.
    for required in ("StoryDola.exe", "APP_INFO.txt"):
        path = target / required
        if not path.is_file():
            parser.error(f"target bundle is missing {required}")
        if path not in changed:
            changed.append(path)

    output.parent.mkdir(parents=True, exist_ok=True)
    top_folder = target.name
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
        for source in sorted(changed, key=lambda item: item.relative_to(target).as_posix().lower()):
            relative = source.relative_to(target).as_posix()
            archive.write(source, f"{top_folder}/{relative}")

    size = output.stat().st_size
    print(f"Patch: {len(changed)} file(s), {size / 1024 / 1024:.1f} MiB -> {output}")


if __name__ == "__main__":
    main()
