#!/bin/sh
# Copies this machine's squad_dashboard database into Docker's, replacing what is there: no first collection to wait for.
set -e
cd "$(dirname "$0")/.."
. scripts/docker.sh
dump=$(mktemp)
trap 'rm -f "$dump"' EXIT
pg_dump -Fc -d "${SD_SOURCE_DB:-squad_dashboard}" -f "$dump"
compose stop app
compose cp "$dump" db:/tmp/squad_dashboard.dump
compose exec -T db pg_restore -U squad_dashboard -d squad_dashboard --no-owner --no-privileges --clean --if-exists \
  /tmp/squad_dashboard.dump
compose exec -T db rm /tmp/squad_dashboard.dump
compose start app
