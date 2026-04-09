"""FMP data via stock-screener Express proxy only (C2) — /api/ai-hedge-fund/fmp/*."""
from __future__ import annotations

import logging
from typing import Any

import requests

from src.tools.market_data_env import get_stock_screener_api_base

logger = logging.getLogger(__name__)

TIMEOUT_S = 120


def fmp_proxy_get(path: str, params: dict[str, Any] | None = None) -> tuple[Any | None, str | None]:
    """
    path: FMP stable subpath e.g. '/profile' or '/key-metrics-ttm'
    Returns (data, error_message). data is the inner JSON from { ok: true, data }.
    """
    base = get_stock_screener_api_base()
    p = path if path.startswith("/") else f"/{path}"
    url = f"{base}/api/ai-hedge-fund/fmp{p}"
    try:
        r = requests.get(url, params=params or {}, timeout=TIMEOUT_S, headers={"Accept": "application/json"})
        body = r.json() if r.text else {}
        if r.status_code != 200 or not body.get("ok"):
            err = body.get("error") or r.text[:500] or f"HTTP {r.status_code}"
            return None, str(err)
        return body.get("data"), None
    except Exception as e:
        logger.warning("fmp proxy %s: %s", p, e)
        return None, str(e)
