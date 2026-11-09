#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"
docker compose down
echo "StoryAI stopped. Local data volume was kept."
