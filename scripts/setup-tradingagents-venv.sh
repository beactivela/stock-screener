#!/usr/bin/env bash
# Creates .venv-tradingagents and pip-installs the vendored TradingAgents package (editable).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f vendor/TradingAgents/pyproject.toml ]]; then
  echo "Missing vendor/TradingAgents. Run: git submodule update --init --recursive" >&2
  exit 1
fi

VENV="${ROOT}/.venv-tradingagents"
python3 -m venv "$VENV"
"${VENV}/bin/pip" install -U pip
"${VENV}/bin/pip" install -r "${ROOT}/requirements-tradingagents.txt"

echo ""
echo "TradingAgents installed in: ${VENV}"
echo "Activate: source .venv-tradingagents/bin/activate"
echo "CLI: tradingagents   (or: python -m cli.main from vendor/TradingAgents)"
