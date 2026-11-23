#!/bin/bash
cd "$(dirname -- "$0")"
npm start
status=$?
if [ "$status" -ne 0 ]; then
  read -r -p "Press Enter to close this window..."
fi
exit "$status"
