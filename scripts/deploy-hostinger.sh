#!/usr/bin/env bash
# Push local code to Hostinger VPS and run Docker.
# Usage: VPS=user@YOUR_VPS_IP ./scripts/deploy-hostinger.sh
# Or set VPS in ~/.ssh/config and use: VPS=myhost ./scripts/deploy-hostinger.sh

set -e

if [[ -z "$VPS" ]]; then
  echo "Set VPS host. Example: VPS=root@1.2.3.4 $0"
  exit 1
fi

REMOTE_DIR="${REMOTE_DIR:-/var/www/stock-screener}"

echo "Syncing to $VPS:$REMOTE_DIR ..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude dist \
  --exclude .env \
  --exclude "*.log" \
  . "$VPS:$REMOTE_DIR/"

echo "Running Docker on VPS..."
ssh "$VPS" "cd $REMOTE_DIR && docker compose up -d --build"

echo "Done. App should be at http://<VPS_IP>:3001"
echo "Logs: ssh $VPS 'cd $REMOTE_DIR && docker compose logs -f'"
