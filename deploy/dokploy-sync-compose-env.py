#!/usr/bin/env python3
"""Run on the VPS once: sync running stock-screener env into Dokploy compose row (no stdout secrets)."""
import json
import subprocess
import sys
import uuid

COMPOSE_ID = "FqW1DKITiMuO24sV3yDk7"

def main() -> None:
    raw = subprocess.check_output(
        ["docker", "inspect", "stock-screener", "-f", "{{json .Config.Env}}"],
        text=True,
    )
    env_list = json.loads(raw)
    skip = {"PATH", "NODE_VERSION", "YARN_VERSION"}
    lines = []
    for e in env_list:
        k, _, _ = e.partition("=")
        if k in skip:
            continue
        lines.append(e)
    blob = "\n".join(lines)
    tag = "e" + uuid.uuid4().hex
    dollar_env = f"${tag}${blob}${tag}$"
    sql = (
        "UPDATE compose SET "
        '"sourceType" = \'git\', '
        '"customGitUrl" = \'https://github.com/beactivela/stock-screener.git\', '
        '"customGitBranch" = \'main\', '
        '"composePath" = \'./docker-compose.dokploy.yml\', '
        '"enableSubmodules" = true, '
        '"owner" = NULL, "repository" = NULL, "branch" = NULL, "githubId" = NULL, '
        '"autoDeploy" = true, '
        f'"env" = {dollar_env} '
        f'WHERE "composeId" = \'{COMPOSE_ID}\';'
    )
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            subprocess.check_output(
                ["docker", "ps", "-q", "-f", "name=dokploy-postgres"],
                text=True,
            ).strip(),
            "psql",
            "-U",
            "dokploy",
            "-d",
            "dokploy",
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            "-",
        ],
        input=sql,
        text=True,
        check=True,
    )
    print("OK: compose row updated", file=sys.stderr)


if __name__ == "__main__":
    main()
