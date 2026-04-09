"""Env for market data routing (composite = stock-screener bars + FMP via Express proxy)."""
import os

# composite | stock_screener | supabase | financial_datasets
DEFAULT_MARKET_DATA_MODE = "composite"


def get_market_data_mode() -> str:
    return (os.environ.get("HEDGE_FUND_MARKET_DATA") or DEFAULT_MARKET_DATA_MODE).strip().lower()


def get_stock_screener_api_base() -> str:
    return (os.environ.get("STOCK_SCREENER_API_BASE") or "http://127.0.0.1:5174").rstrip("/")


def has_financial_datasets_key() -> bool:
    k = os.environ.get("FINANCIAL_DATASETS_API_KEY") or ""
    return bool(k.strip()) and "your-financial-datasets" not in k.lower()
