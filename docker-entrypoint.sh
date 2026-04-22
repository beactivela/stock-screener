#!/bin/sh
set -eu

# Named Docker volumes are commonly mounted as root-owned paths.
# Fix ownership on each start so the app can write caches and study artifacts.
mkdir -p /app/data/bars /app/eval_results
chown -R nodejs:nodejs /app/data /app/eval_results

exec su -s /bin/sh nodejs -c 'exec "$0" "$@"' -- "$@"
