#!/bin/sh
# Regenerate one screenshot: ./shoot.sh "<page.html?query>" <out.png> [width] [height]
# Uses Playwright's headless shell (viewport = window size exactly). Override with CHROME=...
CH="${CHROME:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)}"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="${3:-1366},${4:-768}" --virtual-time-budget=6000 \
  --screenshot="$2" "file://$DIR/$1" >/dev/null 2>&1
