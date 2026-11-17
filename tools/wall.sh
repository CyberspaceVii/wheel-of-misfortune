#!/usr/bin/env bash
# wall.sh SRC [N]: build wallpaper public/img/wall-N.webp (default N=1) from a photo. The app picks
# one of img/wall-*.webp at random per page load (WALLS in js/wall.js; keep the list in step).
# Scaled to fit 2400 px, then a circular alpha: fully opaque in the middle, easing to
# transparent at the edges, so the image melts into the page's black (no hard frame).
set -euo pipefail
src="${1:?usage: wall.sh SRC [N]}"; n="${2:-1}"
cd "$(dirname "$0")/.."
out=public/img/wall-$n.webp
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

magick "$src" -auto-orient -strip -colorspace sRGB -resize '2400x2400>' "$tmp/base.png"
read -r w h < <(magick identify -format '%w %h\n' "$tmp/base.png")
# circular alpha: r reaches past the corners; opaque to 45% of r, smoothstep to clear at r
r=$(( (w > h ? w : h) * 6 / 10 ))
magick -size "${w}x${h}" xc: -fx "rr=hypot(i-w/2,j-h/2)/$r; ss=max(0,min(1,(rr-0.45)/0.55)); 1-ss*ss*(3-2*ss)" "$tmp/mask.png"
magick "$tmp/base.png" "$tmp/mask.png" -alpha off -compose CopyOpacity -composite \
  -quality 82 -define webp:alpha-quality=90 "$out"
magick identify -format '%f %wx%h %[channels] %b\n' "$out"
