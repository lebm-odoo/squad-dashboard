#!/bin/sh
# The dashboard as an app, in a Chrome window of its own without the browser around it: `scripts/app.sh install` once
# adds it to the application launcher. It starts the server when none answers, and stops it when the window closes,
# once a running collection is over.
set -e
root=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
icon="$root/apps/web/src/lib/assets/favicon.svg"
data=${DATA_DIR:-$HOME/.local/share/squad-dashboard}
# 127.0.0.1 rather than localhost: Chrome names the window after the host, apart from another dashboard on localhost.
url="http://127.0.0.1:${PORT:-8766}/"

if [ "${1:-}" = install ]; then
  apps=${XDG_DATA_HOME:-$HOME/.local/share}/applications
  mkdir -p "$apps"
  # Chrome names the window after the address and the profile: the launcher and the compositor know it by that name.
  cat > "$apps/squad-dashboard.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Squad Dashboard
Comment=Moi et mon squad, dans leur fenêtre
Exec="$root/scripts/app.sh"
Icon=$icon
Terminal=false
Categories=Development;
StartupWMClass=chrome-127.0.0.1__-Default
EOF
  echo "dans le lanceur : $apps/squad-dashboard.desktop"
  exit 0
fi

fail() {
  notify-send -i "$icon" 'Squad Dashboard' "$1" 2>/dev/null || true
  echo "$1" >&2
  exit 1
}
up() { curl -s -o /dev/null "${url}api/health"; }

browser=$(command -v google-chrome-stable google-chrome chromium-browser chromium | head -n 1)
[ -n "$browser" ] || fail 'il faut Google Chrome ou Chromium'

server=
if ! up; then
  PATH=$PATH:$HOME/.bun/bin
  mkdir -p "$data"
  cd "$root"
  [ -d apps/web/build ] || bun run build > "$data/server.log" 2>&1 || fail "la page ne se construit pas : $data/server.log"
  bun apps/server/src/main.ts > "$data/server.log" 2>&1 &
  server=$!
  until up; do
    kill -0 "$server" 2> /dev/null || fail "le serveur s'est arrêté : $data/server.log"
    sleep 0.5
  done
fi

# A profile of its own: its own window, and this call returns only when it closes.
"$browser" --app="$url" --user-data-dir="$data/app" --no-first-run --no-default-browser-check
[ -n "$server" ] || exit 0
while curl -s "${url}api/collect" | grep -q '"running":true'; do sleep 5; done
kill "$server"
