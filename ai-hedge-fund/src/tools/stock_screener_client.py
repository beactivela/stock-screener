"""HTTP client for stock-screener Express: bars + fundamentals (no FMP key in this process)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import requests

from src.tools.market_data_env import get_stock_screener_api_base

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 120


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


def fetch_bars_json(ticker: str, start_date: str, end_date: str) -> dict[str, Any] | None:
    """GET /api/bars/:ticker — returns { results: [{ t, o, h, l, c, v }, ...] } or None on failure."""
    t = ticker.upper().strip()
    d0 = datetime.strptime(start_date, "%Y-%m-%d")
    d1 = datetime.strptime(end_date, "%Y-%m-%d")
    days = max(5, (d1 - d0).days + 10)
    base = get_stock_screener_api_base()
    url = f"{base}/api/bars/{t}"
    try:
        r = _session().get(
            url,
            params={"days": days, "interval": "1d"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            logger.warning("stock-screener bars %s: HTTP %s", t, r.status_code)
            return None
        return r.json()
    except Exception as e:
        logger.warning("stock-screener bars %s: %s", t, e)
        return None


def fetch_fundamentals_json(ticker: str) -> dict[str, Any] | None:
    """GET /api/fundamentals/:ticker — merged Yahoo raw + columns."""
    t = ticker.upper().strip()
    base = get_stock_screener_api_base()
    url = f"{base}/api/fundamentals/{t}"
    try:
        r = _session().get(url, timeout=REQUEST_TIMEOUT_S)
        if r.status_code != 200:
            logger.warning("stock-screener fundamentals %s: HTTP %s", t, r.status_code)
            return None
        return r.json()
    except Exception as e:
        logger.warning("stock-screener fundamentals %s: %s", t, e)
        return None
