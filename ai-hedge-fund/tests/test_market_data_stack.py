"""Tests for composite market data (stock-screener + FMP proxy) without live HTTP."""
import os
from datetime import datetime
from unittest.mock import patch

import pytest

from src.tools.market_data_env import has_financial_datasets_key
from src.tools.market_data_mappers import bars_results_to_prices, fmp_key_metrics_row_to_financial_metrics


class TestMarketDataEnv:
    def test_has_financial_datasets_key_rejects_placeholder(self):
        with patch.dict(os.environ, {"FINANCIAL_DATASETS_API_KEY": "your-financial-datasets-api-key"}, clear=False):
            assert has_financial_datasets_key() is False

    def test_has_financial_datasets_key_accepts_realish(self):
        with patch.dict(os.environ, {"FINANCIAL_DATASETS_API_KEY": "fd_live_abc123"}, clear=False):
            assert has_financial_datasets_key() is True


class TestMappers:
    def test_bars_results_to_prices(self):
        t_ms = int(datetime(2024, 1, 15, 16, 0, 0).timestamp() * 1000)
        results = [{"t": t_ms, "o": 100.0, "h": 102.0, "l": 99.0, "c": 101.0, "v": 1000}]
        prices = bars_results_to_prices("AAPL", results, "2024-01-01", "2024-01-31")
        assert len(prices) == 1
        assert prices[0].close == 101.0
        assert prices[0].volume == 1000

    def test_fmp_key_metrics_row_maps(self):
        row = {
            "peRatioTTM": 28.5,
            "marketCap": 3e12,
            "returnOnEquityTTM": 0.15,
        }
        m = fmp_key_metrics_row_to_financial_metrics("AAPL", row, "2024-12-31", "ttm")
        assert m.ticker == "AAPL"
        assert m.price_to_earnings_ratio == 28.5
        assert m.market_cap == 3e12


class TestCompositePrices:
    @patch("src.tools.api.fetch_bars_json")
    @patch("src.tools.api._cache")
    def test_get_prices_uses_screener_when_composite(self, mock_cache, mock_fetch):
        mock_cache.get_prices.return_value = None
        t_ms = int(datetime(2024, 1, 15, 16, 0, 0).timestamp() * 1000)
        mock_fetch.return_value = {
            "results": [{"t": t_ms, "o": 100.0, "h": 102.0, "l": 99.0, "c": 101.0, "v": 1000}],
        }
        with patch.dict(
            os.environ,
            {
                "HEDGE_FUND_MARKET_DATA": "composite",
                "STOCK_SCREENER_API_BASE": "http://127.0.0.1:5174",
            },
            clear=False,
        ):
            from src.tools.api import get_prices

            out = get_prices("AAPL", "2024-01-01", "2024-01-31")
        assert len(out) == 1
        mock_cache.set_prices.assert_called_once()
