#!/usr/bin/env python3
"""
JSONL runner for TradingAgents (stdout = one JSON object per line).
Invoked by Express POST /api/tradingagents/run
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Repo root = parent of scripts/
REPO_ROOT = Path(__file__).resolve().parents[2]


def _emit(obj: dict) -> None:
    payload = {**obj, "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _safe_str(v, max_len: int = 12000) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if len(s) <= max_len else s[:max_len] + "…"


def _summarize_state(fs: dict) -> dict:
    keys = (
        "company_of_interest",
        "trade_date",
        "market_report",
        "sentiment_report",
        "news_report",
        "fundamentals_report",
        "investment_plan",
        "trader_investment_plan",
        "final_trade_decision",
    )
    out: dict = {}
    for k in keys:
        if k in fs:
            out[k] = _safe_str(fs.get(k))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--as-of", dest="as_of", required=True)
    parser.add_argument("--provider", required=True)
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv

        load_dotenv(REPO_ROOT / ".env")
    except Exception:
        pass

    _emit({"type": "progress", "phase": "boot", "message": "Loading TradingAgents graph"})

    try:
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        config = DEFAULT_CONFIG.copy()
        config["llm_provider"] = args.provider

        _emit({"type": "progress", "phase": "running", "message": f"Running analysis for {args.ticker} @ {args.as_of}"})

        ta = TradingAgentsGraph(debug=False, config=config)
        final_state, rating = ta.propagate(args.ticker, args.as_of)

        fs_dict = final_state if isinstance(final_state, dict) else {}
        decision = {
            "rating": str(rating).strip() if rating is not None else None,
            "state": _summarize_state(fs_dict),
        }
        _emit({"type": "result", "decision": decision})
        return 0
    except Exception as e:
        _emit({"type": "error", "message": f"{e}\n{traceback.format_exc()}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
