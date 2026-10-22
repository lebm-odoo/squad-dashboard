#!/bin/sh
# Brings this install to the latest release: `scripts/update.sh docker`, or `bun` without Docker. The database is saved in
# backups/ first, then the code goes to the release, then Docker is rebuilt and restarted, or the page rebuilt. The server
# migrates the database as it starts.
set -e
cd "$(dirname "$0")/.."
case "${1:-}" in
  docker) . scripts/docker.sh ;;
  bun) ;;
  *) echo "usage : $0 docker|bun, selon que le tableau tourne dans Docker ou avec bun run start" >&2; exit 1 ;;
esac
git fetch --quiet --tags origin
tag=$(git tag --list 'v*' --sort=-version:refname | grep -v -- - | head -n 1)
[ -n "$tag" ] || { echo "aucune release publiée sur origin" >&2; exit 1; }
if git merge-base --is-ancestor "$tag" HEAD; then
  echo "déjà à jour : $tag"
  exit 0
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "des changements locaux : les commiter ou les mettre de côté (git stash)" >&2; exit 1; }

mkdir -p backups
backup="backups/squad_dashboard-$(date +%Y%m%d-%H%M%S).dump"
if [ "$1" = docker ]; then
  compose exec -T db pg_dump -U squad_dashboard -Fc squad_dashboard > "$backup"
else
  pg_dump -Fc -d "${DATABASE_URL:-postgres:///squad_dashboard?host=/var/run/postgresql}" -f "$backup"
fi
echo "base sauvegardée : $backup"

if [ -n "$(git branch --show-current)" ]; then
  git merge --ff-only "$tag" || { echo "la branche a divergé de $tag : la mettre à jour à la main" >&2; exit 1; }
else
  git checkout --quiet "$tag"
fi
echo "code à $tag"

if [ "$1" = docker ]; then
  # The commit Settings › About shows: the image holds no .git.
  SD_COMMIT=$(git rev-parse --short HEAD)
  export SD_COMMIT
  compose up -d --build
else
  bun install --frozen-lockfile
  bun run build
  echo "relancer le serveur : bun run start"
fi
