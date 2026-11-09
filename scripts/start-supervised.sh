#!/bin/bash

# Keep the production server alive when Next exits unexpectedly. This is
# intentionally a small supervisor so StoryAI does not depend on an open
# terminal session or an extra global package such as pm2.
set -u

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
log_dir="$project_root/logs"
mkdir -p "$log_dir"
log_file="$log_dir/storyai-supervisor.log"
port=3011

list_port_pids() {
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
}

stop_storyai_supervisor_ancestors() {
  local pid parent command depth

  for pid in "$@"; do
    depth=0
    while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$depth" -lt 12 ]; do
      command=$(ps -p "$pid" -o command= 2>/dev/null || true)
      case "$command" in
        *"$project_root/scripts/start-supervised.sh"*|*"./scripts/start-supervised.sh"*)
          if [ "$pid" != "$$" ]; then
            printf 'Stopping previous StoryAI supervisor (PID %s)\n' "$pid"
            kill -TERM "$pid" 2>/dev/null || true
          fi
          ;;
      esac

      parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      [ -n "$parent" ] && [ "$parent" != "$pid" ] || break
      pid=$parent
      depth=$((depth + 1))
    done
  done
}

clear_port() {
  local pids attempt

  if ! command -v lsof >/dev/null 2>&1; then
    printf 'Cannot clear port %s: lsof is not installed\n' "$port" >&2
    return 1
  fi

  pids=$(list_port_pids)
  [ -n "$pids" ] || return 0

  printf 'Clearing port %s (PID(s): %s)\n' "$port" "$(printf '%s' "$pids" | tr '\n' ' ')"
  stop_storyai_supervisor_ancestors $pids
  kill $pids 2>/dev/null || true

  attempt=0
  while [ "$attempt" -lt 5 ]; do
    pids=$(list_port_pids)
    [ -z "$pids" ] && return 0
    sleep 1
    attempt=$((attempt + 1))
  done

  pids=$(list_port_pids)
  if [ -n "$pids" ]; then
    printf 'Port %s is still occupied; forcing PID(s) %s to stop\n' "$port" "$(printf '%s' "$pids" | tr '\n' ' ')" >&2
    kill -KILL $pids 2>/dev/null || true
    sleep 1
  fi

  pids=$(list_port_pids)
  if [ -n "$pids" ]; then
    printf 'Unable to clear port %s; PID(s) %s still own it\n' "$port" "$(printf '%s' "$pids" | tr '\n' ' ')" >&2
    return 1
  fi
}

stopping=0
trap 'stopping=1' INT TERM HUP

cd "$project_root" || exit 1
clear_port || exit 1
printf '%s Building StoryAI production assets\n' "$(date '+%Y-%m-%d %H:%M:%S')"
if ! npm run build; then
  printf '%s StoryAI build failed; server was not started\n' "$(date '+%Y-%m-%d %H:%M:%S')" >&2
  exit 1
fi
printf '%s StoryAI supervisor started\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$log_file"
printf 'StoryAI frontend and API: http://localhost:%s\n' "$port"
printf 'Supervisor log: %s\n' "$log_file"

while [ "$stopping" -eq 0 ]; do
  npm run start:server 2>&1 | tee -a "$log_file"
  exit_code=${PIPESTATUS[0]}
  [ "$stopping" -eq 1 ] && break
  printf '%s next start exited with code %s; retrying in 2 seconds\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$exit_code" | tee -a "$log_file"
  sleep 2
done

printf '%s StoryAI supervisor stopped\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$log_file"
