"""Optional direct Supabase (PostgREST) reads when HEDGE_FUND_MARKET_DATA=supabase."""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

from src.data.models import Price
from src.tools.market_data_mappers import bars_results_to_prices

logger = logging.getLogger(__name__)


def supabase_get_prices(ticker: str, start_date: str, end_date: str) -> list[Price]:
    """Read bars_cache.results for 1d interval; empty if not configured."""
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        return []
    t = ticker.upper().strip()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    try:
        r = requests.get(
            f"{url}/rest/v1/bars_cache",
            params={
                "select": "results,date_from,date_to",
                "ticker": f"eq.{t}",
                "interval": "eq.1d",
            },
            headers=headers,
            timeout=120,
        )
        if r.status_code != 200:
            logger.warning("supabase bars_cache: HTTP %s", r.status_code)
            return []
        rows = r.json()
        if not isinstance(rows, list) or not rows:
            return []
        results = rows[0].get("results") or []
        if not isinstance(results, list):
            return []
        return bars_results_to_prices(t, results, start_date, end_date)
    except Exception as e:
        logger.warning("supabase bars_cache: %s", e)
        return []
