"""
Data layer: fetch OHLCV via yfinance for regime HMM and strategy.
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta


def fetch_ohlcv(
    ticker: str,
    years: int = 5,
    end_date: datetime | None = None,
) -> pd.DataFrame:
    """
    Fetch daily OHLCV for a ticker. Uses yfinance (no API key).
    Returns DataFrame with columns: Open, High, Low, Close, Volume, plus Date index.
    """
    end = end_date or datetime.now()
    start = end - timedelta(days=years * 365)
    t = yf.Ticker(ticker)
    df = t.history(start=start, end=end, interval="1d", auto_adjust=True)
    if df.empty or len(df) < 100:
        raise ValueError(f"Insufficient data for {ticker}: got {len(df)} rows")
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(how="all")
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df.sort_index()


def fetch_multiple(
    tickers: list[str],
    years: int = 5,
    end_date: datetime | None = None,
) -> dict[str, pd.DataFrame]:
    """Fetch OHLCV for multiple tickers. Returns dict ticker -> DataFrame."""
    out = {}
    for t in tickers:
        try:
            out[t] = fetch_ohlcv(t, years=years, end_date=end_date)
        except Exception as e:
            out[t] = None  # or re-raise
    return out
