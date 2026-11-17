#!/usr/bin/env bash
# Wheel of Misfortune: deploy, render the system config, or build a portable tarball.
# Paths come from deploy.conf (copy deploy.conf.example): $WOM_CONF, else ./deploy.conf, else
# ~/.config/wom/deploy.conf. Nothing is tied to one host.
#
#   ./deploy.sh              check, then install (everything root:root 755/644):
#                              public/       → $WOM_WEBROOT  (mirrored 1:1: files no longer in
#                                              public/ are removed from the live copy)
#                              server/       → $WOM_APP      (api.php + starter-wheels.json)
#                              ops/worker.py → $WOM_LIB/worker.py
#   ./deploy.sh config DIR   write ops/ with deploy.conf's values filled in, to DIR, for
#                            installing by hand (see README.md); touches nothing else
#   ./deploy.sh package [F]  build F (default wom-YYYYMMDD.tar.gz) from the files .gitignore keeps
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-deploy}"

conf() {
  local c
  for c in "${WOM_CONF:-}" "$HERE/deploy.conf" "${XDG_CONFIG_HOME:-$HOME/.config}/wom/deploy.conf"; do
    [[ -n "$c" && -f "$c" ]] && break
  done
  [[ -n "$c" && -f "$c" ]] || { echo "no deploy.conf: copy deploy.conf.example and edit it" >&2; exit 1; }
  # shellcheck source=/dev/null
  source "$c"
  for v in WOM_URL WOM_WEBROOT WOM_APP WOM_LIB WOM_DATA WOM_SOCK WOM_WEB_USER WOM_PIPER; do
    [[ -v $v ]] || { echo "deploy.conf: $v is not set" >&2; exit 1; }
  done
}

check() {
  php -l "$HERE/server/api.php" >/dev/null
  for f in "$HERE"/public/js/*.js; do node --check "$f"; done
  python3 -c 'import json,sys; [json.load(open(f)) for f in sys.argv[1:]]' "$HERE/server/starter-wheels.json" "$HERE/public/music/soundtrack.json"
  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$HERE/ops/worker.py"
}

as_root() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi; }

case "$CMD" in
deploy)
  conf; check
  cd "$HERE/public"
  as_root install -d -o root -g root -m 755 "$WOM_WEBROOT"
  find . -type d -printf '%P\n' | while read -r d; do
    [[ -n "$d" ]] && as_root install -d -o root -g root -m 755 "$WOM_WEBROOT/$d"
  done
  find . -type f -printf '%P\n' | while read -r f; do
    as_root install -o root -g root -m 644 "$f" "$WOM_WEBROOT/$f"
  done
  # mirror: drop live files and dirs that public/ no longer has
  as_root find "$WOM_WEBROOT" -mindepth 1 -type f -printf '%P\n' | while read -r f; do
    [[ -e "$f" ]] || { as_root rm -f -- "$WOM_WEBROOT/$f"; echo "removed $f"; }
  done
  as_root find "$WOM_WEBROOT" -mindepth 1 -depth -type d -empty -delete
  echo "deployed $(find . -type f | wc -l) files to $WOM_WEBROOT"

  as_root install -d -o root -g root -m 755 "$WOM_APP" "$WOM_LIB"
  as_root install -o root -g root -m 644 "$HERE/server/api.php" "$HERE/server/starter-wheels.json" "$WOM_APP/"
  as_root install -o root -g root -m 755 "$HERE/ops/worker.py" "$WOM_LIB/worker.py"
  echo "deployed server/ to $WOM_APP, worker to $WOM_LIB"
  ;;
config)
  conf
  out="${2:?usage: ./deploy.sh config DIR}"
  mkdir -p "$out"
  for f in "$HERE"/ops/*; do
    [[ -f "$f" ]] || continue
    sed -e "s#@URL@#$WOM_URL#g" -e "s#@WEBROOT@#$WOM_WEBROOT#g" -e "s#@APP@#$WOM_APP#g" \
        -e "s#@LIB@#$WOM_LIB#g" -e "s#@DATA@#$WOM_DATA#g" -e "s#@SOCK@#$WOM_SOCK#g" \
        -e "s#@WEB_USER@#$WOM_WEB_USER#g" -e "s#@PIPER@#$WOM_PIPER#g" "$f" > "$out/$(basename "$f")"
  done
  chmod 755 "$out/worker.py"
  echo "wrote $(ls "$out" | wc -l) files to $out (install them as README.md says)"
  ;;
package)
  check
  out="${2:-$PWD/wom-$(date +%Y%m%d).tar.gz}"
  tar -C "$(dirname "$HERE")" -czf "$out" --transform "s#^$(basename "$HERE")#wom#" \
    --exclude-vcs --exclude-vcs-ignores "$(basename "$HERE")"
  echo "wrote $out ($(du -h "$out" | cut -f1))"
  ;;
*) echo "usage: ./deploy.sh [deploy | config DIR | package [FILE]]" >&2; exit 2 ;;
esac
