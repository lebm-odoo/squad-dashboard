# Sourced by the Docker scripts: `compose` runs docker compose as this user when the daemon lets them, through sudo
# otherwise, keeping what compose.yaml reads; joining the docker group instead is worth root, a choice left to you.
command -v docker >/dev/null || { echo "Docker n'est pas installé" >&2; exit 1; }
if docker info >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
else
  echo "Docker demande les droits root : les commandes passent par sudo" >&2
  compose() { sudo --preserve-env=SD_COMMIT,SD_PORT,SD_CLONES,SD_DB_PASSWORD,TZ docker compose "$@"; }
fi
