#!/usr/bin/env python3
"""
Long-lived TradingAgents runner: read one JSON job per line on stdin; emit JSONL events
on stdout (same schema as run.py), then a terminal line {"type":"__end__","code":<int>}.

Protocol (newline-delimited JSON):
  - Request line: {"ticker","asOf","provider","analysts":["market",...]}
  - Response: many lines from the graph, then {"type":"__end__","code":0}

Start once, e.g.:
  TRADINGAGENTS_USE_DOTENV=1 .venv-tradingagents/bin/python -u scripts/tradingagents/worker_stdio.py

Then set TRADINGAGENTS_STDIO_WORKER=1 on the Node server so /api/tradingagents/run multiplexes
to this process (single in-flight job; second client gets 409).
"""
from __future__ import annotations

import json
import sys
from argparse import Namespace
from importlib import util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_run_module():
    run_path = Path(__file__).resolve().parent / "run.py"
    spec = util.spec_from_file_location("tradingagents_run_job", run_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load run.py")
    mod = util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _namespace_from_payload(d: dict) -> Namespace:
    analysts = d.get("analysts")
    if isinstance(analysts, list):
        acsv = ",".join(str(a).strip().lower() for a in analysts if str(a).strip())
    else:
        acsv = str(d.get("analystsCsv") or "market,social,news,fundamentals")
    return Namespace(
        ticker=str(d["ticker"]).strip(),
        as_of=str(d["asOf"]).strip(),
        provider=str(d["provider"]).strip().lower(),
        analysts=acsv,
    )


def main() -> None:
    mod = _load_run_module()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            ns = _namespace_from_payload(payload)
            code = mod.run_job(ns)
        except Exception as e:
            print(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False), flush=True)
            code = 1
        print(json.dumps({"type": "__end__", "code": code}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
