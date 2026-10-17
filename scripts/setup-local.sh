#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GATEWAY_DIR="$ROOT_DIR/dola-studio/dola-render-gateway"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Cần cài Node.js 20.9+ và npm trước." >&2
  exit 1
fi
NODE_VERSION=$(node -p 'process.versions.node')
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)'; then
  echo "Node.js hiện tại là $NODE_VERSION; dự án cần Node.js 20.9 trở lên." >&2
  exit 1
fi
if ! npm --version >/dev/null 2>&1; then
  echo "Không chạy được npm. Hãy cài lại Node.js LTS có kèm npm." >&2
  exit 1
fi
echo "Node.js $NODE_VERSION / npm $(npm --version)"
if ! command -v lsof >/dev/null 2>&1; then
  echo "Thiếu lsof; npm start cần công cụ này để kiểm tra/dọn cổng trên Linux. Trên Ubuntu/WSL chạy: sudo apt install lsof" >&2
  exit 1
fi
PYTHON_BIN=${PYTHON_BIN:-}
if [ -n "$PYTHON_BIN" ]; then
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Không tìm thấy Python tại PYTHON_BIN=$PYTHON_BIN." >&2
    exit 1
  fi
  if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
    echo "Cần Python 3.11 trở lên." >&2
    exit 1
  fi
else
  for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
      PYTHON_BIN=$candidate
      break
    fi
  done
fi
if [ -z "$PYTHON_BIN" ]; then
  echo "Cần Python 3.11 trở lên." >&2
  exit 1
fi

cd "$ROOT_DIR"
npm ci
cd "$ROOT_DIR/dola-studio"
npm ci
"$PYTHON_BIN" -m venv "$GATEWAY_DIR/.venv"
"$GATEWAY_DIR/.venv/bin/python" -m pip install --upgrade pip
"$GATEWAY_DIR/.venv/bin/python" -m pip install -r "$GATEWAY_DIR/requirements.txt"
"$GATEWAY_DIR/.venv/bin/patchright" install chromium
cd "$ROOT_DIR"
node scripts/prepare-local-config.cjs

echo "Cài đặt xong. Chạy npm start rồi mở http://127.0.0.1:3021."
