# Sourced by the Docker scripts: `compose` runs docker compose as this user when the daemon lets them, through sudo
# otherwise, keeping what compose.yaml reads; joining the docker group instead is worth root, a choice left to you.
command -v docker >/dev/null || { echo "Docker n'est pas installé" >&2; exit 1; }
if docker info >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif [ -t 0 ]; then
  echo "Docker demande les droits root : les commandes passent par sudo" >&2
  compose() { sudo --preserve-env=SD_COMMIT,SD_PORT,SD_CLONES,SD_DB_PASSWORD,TZ docker compose "$@"; }
else
  # No terminal to ask the password, as from the app's launcher: the desktop asks it. pkexec starts in root's home.
  compose() {
    pkexec env "SD_COMMIT=${SD_COMMIT-}" "SD_PORT=${SD_PORT-}" "SD_CLONES=${SD_CLONES-}" "SD_DB_PASSWORD=${SD_DB_PASSWORD-}" \
      "TZ=${TZ-}" docker compose -f "$PWD/compose.yaml" "$@"
  }
fi
