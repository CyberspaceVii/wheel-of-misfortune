#!/usr/bin/env bash
# shot.sh NAME URL [WxH] [ms]: headless Chromium screenshot into tools/.shots/
set -euo pipefail
cd "$(dirname "$0")"
out=".shots/$1.png"; url="$2"; size="${3:-1280x800}"; ms="${4:-3000}"
mkdir -p .shots
prof=$(mktemp -d -p .shots prof.XXXX)
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --mute-audio ${RM:+--force-prefers-reduced-motion} \
  --user-data-dir="$prof" --window-size="${size/x/,}" --virtual-time-budget="$ms" \
  --screenshot="$out" "$url" >/dev/null 2>&1 || true
rm -rf "${prof:?}"
echo "$out"
