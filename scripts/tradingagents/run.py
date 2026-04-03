#!/usr/bin/env python3
"""
JSONL runner for TradingAgents (stdout = one JSON object per line).
Invoked by Express POST /api/tradingagents/run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import traceback
from argparse import Namespace
from datetime import datetime, timezone
from pathlib import Path

# Repo root = parent of scripts/
REPO_ROOT = Path(__file__).resolve().parents[2]

VALID_ANALYSTS = frozenset({"market", "social", "news", "fundamentals"})
DEFAULT_ANALYSTS_ORDER = ("market", "social", "news", "fundamentals")


def _emit(obj: dict) -> None:
    payload = {**obj, "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _safe_str(v, max_len: int = 12000) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if len(s) <= max_len else s[:max_len] + "…"


def _with_heartbeat(fn):
    """Emit periodic progress on stdout so the SSE stream stays alive and the UI shows activity."""

    interval = float(os.getenv("TRADINGAGENTS_HEARTBEAT_SECONDS", "25"))
    if interval <= 0:
        return fn()

    done = threading.Event()

    def tick() -> None:
        n = 0
        while not done.wait(interval):
            n += 1
            elapsed = int(n * interval)
            _emit(
                {
                    "type": "progress",
                    "phase": "heartbeat",
                    "message": (
                        f"Agent graph still running (~{elapsed}s). "
                        "Many LLM + tool steps; 15–60+ minutes is normal. Leave this page open."
                    ),
                }
            )

    t = threading.Thread(target=tick, daemon=True)
    t.start()
    try:
        return fn()
    finally:
        done.set()


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


def _parse_analyst_csv(raw: str) -> list[str]:
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    if not parts:
        return list(DEFAULT_ANALYSTS_ORDER)
    unknown = [p for p in parts if p not in VALID_ANALYSTS]
    if unknown:
        raise ValueError(f"Invalid --analysts: unknown {unknown}; allowed: {sorted(VALID_ANALYSTS)}")
    # dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _env_bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def run_job(args: Namespace) -> int:
    """Single TradingAgents run; used by CLI and stdio worker."""
    try:
        from dotenv import load_dotenv

        load_dotenv(REPO_ROOT / ".env")
    except Exception:
        pass

    selected = _parse_analyst_csv(args.analysts)
    _emit({"type": "progress", "phase": "boot", "message": "Loading TradingAgents graph"})

    try:
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        config = DEFAULT_CONFIG.copy()
        config["llm_provider"] = args.provider

        # Defaults tuned for real OpenAI accounts: vendored DEFAULT_CONFIG uses GPT-5 ids + Responses API,
        # which can appear to "hang" on long graphs. Prefer gpt-4o / gpt-4o-mini unless overridden in .env.
        config["deep_think_llm"] = os.getenv("TRADINGAGENTS_DEEP_MODEL", "gpt-4o")
        config["quick_think_llm"] = os.getenv("TRADINGAGENTS_QUICK_MODEL", "gpt-4o-mini")
        # Per-HTTP-call timeout (seconds) passed through to LangChain ChatOpenAI / Anthropic / etc.
        config["llm_timeout_seconds"] = float(os.getenv("TRADINGAGENTS_LLM_TIMEOUT_SECONDS", "300"))
        config["llm_max_retries"] = int(os.getenv("TRADINGAGENTS_LLM_MAX_RETRIES", "2"))
        config["max_debate_rounds"] = _env_int(
            "TRADINGAGENTS_MAX_DEBATE_ROUNDS", int(config.get("max_debate_rounds", 1))
        )
        config["max_risk_discuss_rounds"] = _env_int(
            "TRADINGAGENTS_MAX_RISK_DISCUSS_ROUNDS",
            int(config.get("max_risk_discuss_rounds", 1)),
        )
        config["parallel_analysts"] = _env_bool("TRADINGAGENTS_PARALLEL_ANALYSTS")

        _emit(
            {
                "type": "progress",
                "phase": "running",
                "message": (
                    f"Running analysis for {args.ticker} @ {args.as_of} "
                    f"(models: {config['quick_think_llm']}/{config['deep_think_llm']}, "
                    f"analysts: {','.join(selected)}, "
                    f"parallel_analysts: {config['parallel_analysts']})"
                ),
            }
        )

        ta = TradingAgentsGraph(selected_analysts=selected, debug=False, config=config)
        final_state, rating = _with_heartbeat(lambda: ta.propagate(args.ticker, args.as_of))

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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--as-of", dest="as_of", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument(
        "--analysts",
        default=",".join(DEFAULT_ANALYSTS_ORDER),
        help="Comma-separated subset of: market,social,news,fundamentals",
    )
    args = parser.parse_args()
    return run_job(args)


if __name__ == "__main__":
    sys.exit(main())
