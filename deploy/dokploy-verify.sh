#!/usr/bin/env bash
# Quick check: DNS A record + Dokploy on :3000 vs Traefik on :443
#
# If :3000 works but https://hostname/ is 404, DNS is fine — register the host in Dokploy so
# Traefik gets a router + cert (Dokploy docs: Domains → Create Domain):
#   Host: dokploy.scaleagent.org
#   Path: /
#   Container port: 3000
#   HTTPS: on, Certificate: Let's Encrypt
# For the Dokploy panel itself, use the panel/domain section in Dokploy settings (same idea:
# domain must be assigned so dokploy-traefik routes Host() to the dokploy service on 3000).
#
# Usage: ./deploy/dokploy-verify.sh [host] [expected_ipv4]
#   ./deploy/dokploy-verify.sh dokploy.scaleagent.org 89.116.50.166
set -euo pipefail
HOST="${1:-dokploy.scaleagent.org}"
EXPECT="${2:-89.116.50.166}"

echo "=== A record for ${HOST} ==="
got="$(dig +short "$HOST" A | head -1 || true)"
echo "  got: ${got:-<none>}"
if [[ -n "$got" && "$got" == "$EXPECT" ]]; then
  echo "  ok: matches expected ${EXPECT}"
else
  echo "  fix DNS: A record name dokploy (or @) -> ${EXPECT} at your registrar/parking panel"
fi

echo "=== HTTP :3000 (Dokploy UI direct) ==="
code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 8 "http://${HOST}:3000/" || echo "err")"
echo "  http://${HOST}:3000/ -> ${code}"
if [[ "$code" == "200" || "$code" == "302" || "$code" == "301" ]]; then
  echo "  ok: Dokploy reachable on 3000"
else
  echo "  check: ufw allow 3000/tcp, Dokploy service running"
fi

echo "=== HTTPS :443 (Traefik -> Dokploy; needs domain in Dokploy) ==="
code443="$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 8 "https://${HOST}/" || echo "err")"
echo "  https://${HOST}/ -> ${code443}"
if [[ "$code443" == "200" || "$code443" == "302" || "$code443" == "301" ]]; then
  echo "  ok: panel domain + TLS configured"
else
  echo "  NOT ok: add domain in Dokploy (see comment block in this script), then wait for Traefik/LE"
fi
