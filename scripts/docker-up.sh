#!/bin/sh
# Starts the dashboard in Docker with what the container cannot reach by itself: this machine's GitHub token and Odoo key,
# as Docker secrets, and the git e-mail that tells who you are.
set -e
cd "$(dirname "$0")/.."
. scripts/docker.sh
[ -n "$XDG_RUNTIME_DIR" ] || { echo "XDG_RUNTIME_DIR n'est pas défini : lancer depuis une session de bureau" >&2; exit 1; }
for repo in odoo enterprise upgrade; do
  [ -d "${SD_CLONES:-..}/$repo/.git" ] || { echo "pas de clone $repo dans ${SD_CLONES:-..} : SD_CLONES=<dossier des clones> $0" >&2; exit 1; }
done
# Docker mounts a file that exists: the first page fills it.
[ -f config.json ] || echo '{}' > config.json
dir="$XDG_RUNTIME_DIR/squad-dashboard"
umask 077
mkdir -p "$dir"
# Written in place: a running container sees a new token without being recreated.
# Given here, else saved in Settings › Connections (the keyring), else gh's token or the key the V1 kept.
keyring() { secret-tool lookup service squad-dashboard account "$1" 2>/dev/null; }
printf %s "${GH_TOKEN:-$(keyring github_token || gh auth token 2>/dev/null || true)}" > "$dir/github_token"
printf %s "${ODOO_API_KEY:-$(keyring odoo_api_key || keyring odoo-api-key || true)}" > "$dir/odoo_api_key"
[ -s "$dir/github_token" ] || echo "pas de jeton GitHub : gh auth login, ou GH_TOKEN=… $0" >&2
[ -s "$dir/odoo_api_key" ] || echo "pas de clé Odoo : ODOO_API_KEY=… $0, ou la donner dans Réglages › Connexions" >&2
unset GH_TOKEN ODOO_API_KEY
SD_EMAIL="${SD_EMAIL:-$(git config --global user.email 2>/dev/null || true)}"
export SD_EMAIL
SD_COMMIT="$(git rev-parse --short HEAD 2>/dev/null)$(git status --porcelain --untracked-files=no 2>/dev/null | grep -q . && echo +)"
export SD_COMMIT
compose up -d --build "$@"
echo "http://localhost:${SD_PORT:-8766}"
