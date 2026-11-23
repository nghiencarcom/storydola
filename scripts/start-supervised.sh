#!/bin/bash
# npm start replaces the old StoryAI supervisor/server before rebuilding.
set -u
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
log_dir="$project_root/logs"
log_file="$log_dir/storyai-supervisor.log"
lock_dir="$project_root/.storyai-supervisor.lock"
port="${PORT:-}"
if [ -z "$port" ] && [ -f .env ]; then
  port=$(sed -n 's/^PORT=\([0-9][0-9]*\)[[:space:]]*$/\1/p' .env | tail -n 1)
fi
port="${port:-3011}"
case "$port" in *[!0-9]*|'') printf 'PORT must be a number between 1 and 65535.\n' >&2; exit 1 ;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then printf 'PORT must be a number between 1 and 65535.\n' >&2; exit 1; fi
stopping=0
server_pid=""
lock_owned=0
restart_dir="$project_root/.storyai-start.lock"
restart_owned=0
mkdir -p "$log_dir"
cd "$project_root" || exit 1

list_port_pids() { lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u; }
is_live() {
  kill -0 "$1" 2>/dev/null || return 1
  case "$(ps -p "$1" -o stat= 2>/dev/null | tr -d ' ')" in ""|Z*) return 1 ;; esac
  return 0
}
process_cwd() {
  local cwd
  cwd=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ -n "$cwd" ] && (CDPATH= cd -- "$cwd" 2>/dev/null && pwd -P)
}
is_storyai_server_cwd() {
  local cwd
  cwd=$(process_cwd "$1")
  [ "$cwd" = "$project_root" ] || [ "$cwd" = "$project_root/.next/standalone" ]
}
is_supervisor_process() {
  local command
  command=$(ps -p "$1" -o command= 2>/dev/null | sed 's/^[[:space:]]*//')
  case "$command" in
    "bash scripts/start-supervised.sh"|"bash ./scripts/start-supervised.sh"|"/bin/bash scripts/start-supervised.sh"|"/bin/bash ./scripts/start-supervised.sh"|"bash $project_root/scripts/start-supervised.sh"|"/bin/bash $project_root/scripts/start-supervised.sh") return 0 ;;
  esac
  return 1
}
stop_previous_server() {
  local pids pid owner parent command depth attempt
  pids=$(list_port_pids)
  owner=$(cat "$lock_dir/pid" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      if ! is_storyai_server_cwd "$pid"; then
        printf 'Port %s belongs to another application (PID %s); refusing to stop it.\n' "$port" "$pid" >&2
        return 1
      fi
    done
    # Also find supervisors started before PID locks were introduced.
    for pid in $pids; do
      parent=$pid
      depth=0
      while [ "$parent" -gt 1 ] 2>/dev/null && [ "$depth" -lt 12 ]; do
        if [ "$parent" != "$$" ] && is_supervisor_process "$parent"; then
          printf 'Stopping previous StoryAI supervisor (PID %s)\n' "$parent"
          kill -TERM "$parent" 2>/dev/null || true
        fi
        parent=$(ps -p "$parent" -o ppid= 2>/dev/null | tr -d ' ')
        [ -n "$parent" ] || break
        depth=$((depth + 1))
      done
    done
  fi
  if [[ "$owner" =~ ^[0-9]+$ ]] && [ "$owner" != "$$" ] && is_live "$owner"; then
    if is_supervisor_process "$owner"; then
      kill -TERM "$owner" 2>/dev/null || true
    elif is_live "$owner"; then
      printf 'Startup lock belongs to an unexpected live process (PID %s).\n' "$owner" >&2
      return 1
    fi
  fi
  for pid in $pids; do
    printf 'Stopping previous StoryAI server (PID %s)\n' "$pid"
    kill -TERM "$pid" 2>/dev/null || true
  done
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    pids=$(list_port_pids)
    if [ -z "$pids" ] && { ! [[ "$owner" =~ ^[0-9]+$ ]] || ! is_live "$owner"; }; then break; fi
    sleep 1
    attempt=$((attempt + 1))
  done
  # Never rebuild while an old supervisor could still restart or write assets.
  if [[ "$owner" =~ ^[0-9]+$ ]] && is_live "$owner"; then
    printf 'Old supervisor has not stopped; refusing to build concurrently.\n' >&2
    return 1
  fi
  pids=$(list_port_pids)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      is_storyai_server_cwd "$pid" || return 1
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 1
  fi
  [ -z "$(list_port_pids)" ]
}

cleanup() {
  if [ "$restart_owned" -eq 1 ] && [ "$(cat "$restart_dir/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$restart_dir/pid"; rmdir "$restart_dir" 2>/dev/null || true
  fi
  if [ "$lock_owned" -eq 1 ] && [ "$(cat "$lock_dir/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$lock_dir/pid"
    rmdir "$lock_dir" 2>/dev/null || true
  fi
}
stop_server() {
  stopping=1
  # next is a direct child, so terminating it cannot leave an orphaned listener.
  if [ -n "$server_pid" ]; then kill -TERM "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap stop_server INT TERM HUP

# Serialize takeover/build so two simultaneous starts cannot kill/build over each other.
if ! mkdir "$restart_dir" 2>/dev/null; then
  starter=$(cat "$restart_dir/pid" 2>/dev/null || true)
  if [[ "$starter" =~ ^[0-9]+$ ]] && ! is_live "$starter"; then
    rm -f "$restart_dir/pid"; rmdir "$restart_dir" 2>/dev/null || exit 1
    mkdir "$restart_dir" 2>/dev/null || exit 1
  else
    printf 'StoryAI restart/build is already in progress. Log: %s\n' "$log_file"
    exit 0
  fi
fi
restart_owned=1
printf '%s\n' "$$" > "$restart_dir/pid"
stop_previous_server || exit 1
if [ -d "$lock_dir" ]; then
  rm -f "$lock_dir/pid"; rmdir "$lock_dir" 2>/dev/null || exit 1
fi
mkdir "$lock_dir" 2>/dev/null || exit 1
lock_owned=1
printf '%s\n' "$$" > "$lock_dir/pid"

export STORYAI_DATA_DIR="${STORYAI_DATA_DIR:-$project_root/data}"
mkdir -p "$STORYAI_DATA_DIR"
printf '%s StoryAI data directory: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$STORYAI_DATA_DIR" | tee -a "$log_file"
if [ "${STORYAI_SKIP_BUILD:-0}" = "1" ] && [ -s .next/BUILD_ID ]; then
  printf '%s Using prebuilt StoryAI production assets\n' "$(date '+%Y-%m-%d %H:%M:%S')"
else
  printf '%s Building StoryAI production assets\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  if ! npm run build; then
    printf '%s StoryAI build failed; server was not started\n' "$(date '+%Y-%m-%d %H:%M:%S')" >&2
    exit 1
  fi
fi
[ "$stopping" -eq 1 ] && exit 0
[ -s .next/BUILD_ID ] || { printf 'Production BUILD_ID is missing; refusing a restart loop.\n' >&2; exit 1; }
printf '%s StoryAI supervisor started (PID %s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$$" | tee -a "$log_file"
printf 'StoryAI frontend and API: http://localhost:%s\nSupervisor log: %s\n' "$port" "$log_file"

while [ "$stopping" -eq 0 ]; do
  if [ -n "$(list_port_pids)" ]; then
    printf 'Port %s became occupied during startup; stopping instead of looping on EADDRINUSE.\n' "$port" >&2
    exit 1
  fi
  [ -s .next/BUILD_ID ] || { printf 'Production build disappeared; stopping supervisor.\n' >&2; exit 1; }
  if [ -f "$project_root/.next/standalone/server.js" ] && [ -f "$project_root/scripts/start-next-server.js" ]; then
    PORT="$port" node "$project_root/scripts/start-next-server.js" > >(tee -a "$log_file") 2>&1 &
  else
    PORT="$port" "$project_root/node_modules/.bin/next" start -p "$port" > >(tee -a "$log_file") 2>&1 &
  fi
  server_pid=$!
  if [ "$restart_owned" -eq 1 ]; then
    rm -f "$restart_dir/pid"; rmdir "$restart_dir" 2>/dev/null || true
    restart_owned=0
  fi
  wait "$server_pid"
  exit_code=$?
  if [ "$stopping" -eq 1 ]; then
    wait "$server_pid" 2>/dev/null || true
    break
  fi
  server_pid=""
  printf '%s next start exited with code %s; retrying in 2 seconds\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$exit_code" | tee -a "$log_file"
  sleep 2
done
printf '%s StoryAI supervisor stopped\n' "$(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$log_file"
