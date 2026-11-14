#!/usr/bin/env bash
# FALLBACK ONLY: primary deploy is Aiven Runtime. Not used unless Runtime access fails.
# From your laptop (Git Bash / WSL / macOS):  ./deploy/deploy.sh root@<ip>
# Copies the repo (without node_modules/.next/data) + .env to /opt/since and (re)starts the stack.
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@<ip>}"
cd "$(dirname "$0")/.."
[ -f .env.production ] || { echo "Create .env.production first (copy .env.example)"; exit 1; }
tar --exclude=node_modules --exclude=.next --exclude=data --exclude=.env --exclude='.env.*' -czf - . \
  | ssh "$HOST" "mkdir -p /opt/since && tar -xzf - -C /opt/since"
scp .env.production "$HOST:/opt/since/.env"
ssh "$HOST" "cd /opt/since && docker compose up -d --build && docker compose ps"
