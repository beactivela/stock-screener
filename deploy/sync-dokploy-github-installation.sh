#!/usr/bin/env bash
# Run on the VPS (or: ssh user@vps 'bash -s' < deploy/sync-dokploy-github-installation.sh).
# Prerequisite: Install the Dokploy GitHub App in the browser:
#   https://github.com/apps/dokploy-2026-03-30-rqse8e/installations/new
# Pick org/user (e.g. beactivela) and repositories, then "Install".
#
# Optional: GITHUB_ACCOUNT=otherorg ./sync-dokploy-github-installation.sh

set -euo pipefail
export POSTGRES_ID="$(docker ps -q -f name=dokploy-postgres)"
export GITHUB_ROW_ID="PN2phZgrthrt7pBIVZckz"
export APP_ID=3229647
export GITHUB_ACCOUNT="${GITHUB_ACCOUNT:-beactivela}"

KEYFILE="$(mktemp)"
chmod 600 "$KEYFILE"
export KEYFILE
docker exec "$POSTGRES_ID" psql -U dokploy -d dokploy -t -A -c "SELECT \"githubPrivateKey\" FROM github WHERE \"githubId\" = '$GITHUB_ROW_ID';" >"$KEYFILE"

python3 <<'PY'
import jwt, time, json, urllib.request, ssl, subprocess, os, sys

def main():
    key = open(os.environ["KEYFILE"]).read()
    app_id = int(os.environ["APP_ID"])
    target = os.environ.get("GITHUB_ACCOUNT", "beactivela")
    row_id = os.environ["GITHUB_ROW_ID"]
    postgres = os.environ["POSTGRES_ID"]
    now = int(time.time())
    tok = jwt.encode({"iat": now - 60, "exp": now + 600, "iss": app_id}, key, algorithm="RS256")
    if isinstance(tok, bytes):
        tok = tok.decode()
    req = urllib.request.Request(
        "https://api.github.com/app/installations",
        headers={
            "Authorization": "Bearer " + tok,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, context=ssl.create_default_context()) as r:
        data = json.load(r)
    if not data:
        print("No GitHub App installations found. Install the app first:", file=sys.stderr)
        print("https://github.com/apps/dokploy-2026-03-30-rqse8e/installations/new", file=sys.stderr)
        sys.exit(1)
    inst_id = None
    for inst in data:
        acc = (inst.get("account") or {}).get("login")
        if acc == target:
            inst_id = inst["id"]
            break
    if inst_id is None:
        logins = [(inst.get("account") or {}).get("login") for inst in data]
        print(f"No installation for account {target!r}. Found: {logins}", file=sys.stderr)
        sys.exit(1)
    print(f"Found installation id {inst_id} for {target}")
    sql = (
        "UPDATE github SET \"githubInstallationId\" = '"
        + str(inst_id)
        + "' WHERE \"githubId\" = '"
        + row_id
        + "';"
    )
    subprocess.run(
        ["docker", "exec", postgres, "psql", "-U", "dokploy", "-d", "dokploy", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True,
    )
    print("Updated Dokploy github.githubInstallationId.")

if __name__ == "__main__":
    main()
PY
rm -f "$KEYFILE"
echo "Done."
