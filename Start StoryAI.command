#!/bin/bash
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
"$script_dir/scripts/start-storyai.sh"
status=$?
if [ "$status" -ne 0 ]; then
  read -r -p "Press Enter to close this window..."
fi
exit "$status"
