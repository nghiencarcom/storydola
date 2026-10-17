#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -x "$SCRIPT_DIR/.venv/bin/python" ]; then
  echo "Chưa có môi trường Python: $SCRIPT_DIR/.venv" >&2
  echo "Hãy chạy: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt" >&2
  exit 1
fi

LOG_FILE=${DOLA_LOG_FILE:-"$SCRIPT_DIR/dola-gateway.log"}

# Preserve the process PID and logs. The Studio launcher starts this service
# detached so closing Studio does not interrupt shared video workers.
exec "$SCRIPT_DIR/.venv/bin/python" -c \
  'import config, uvicorn; uvicorn.run("server:app", host=config.HOST, port=config.PORT)' \
  >> "$LOG_FILE" 2>&1
