#!/usr/bin/env bash
# Run Streamlit regime trading app (uses .venv if present)
set -e
cd "$(dirname "$0")"
if [[ -d .venv ]]; then
  . .venv/bin/activate
fi
exec streamlit run app.py "$@"
