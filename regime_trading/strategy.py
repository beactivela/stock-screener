"""
Voting system: 8 confirmations. We only enter a trade if:
  1. HMM regime is Bull Run, AND
  2. At least 7 out of 8 conditions are met.

Conditions:
  1. RSI < 90
  2. Momentum > 1%
  3. Volatility < 6%
  4. Price > MA20
  5. Volume < 2x 20-day average volume
  6. 5-day return > 0
  7. Close within 5% of 20-day high (strength)
  8. RSI > 25 (not deeply oversold)
"""

import numpy as np
import pandas as pd

RSI_PERIOD = 14
MA_PERIOD = 20
VOL_MA_PERIOD = 20
MOMENTUM_PCT = 0.01
VOLATILITY_PCT = 0.06
HIGH_NEAR_PCT = 0.05
VOL_SPIKE_MULT = 2.0
MIN_VOTES = 7
TOTAL_CONDITIONS = 8


def rsi(close: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    """Classic RSI (0–100)."""
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi_val = 100 - (100 / (1 + rs))
    return rsi_val.fillna(50)


def volatility_pct(close: pd.Series, window: int = 20) -> pd.Series:
    """Rolling annualized volatility as decimal (e.g. 0.06 = 6%)."""
    ret = close.pct_change()
    return ret.rolling(window, min_periods=window).std() * np.sqrt(252)


def momentum_pct(close: pd.Series, window: int = 1) -> pd.Series:
    """Return over last `window` days as decimal (e.g. 0.01 = 1%)."""
    return (close / close.shift(window) - 1.0).fillna(0)


def evaluate_conditions(df: pd.DataFrame, row_index: int) -> tuple[list[bool], list[str], int]:
    """
    Evaluate all 8 conditions at a given row (most recent = -1 or len-1).
    Returns (list of bool for each condition, list of short labels, vote_count).
    """
    if row_index < MA_PERIOD + 5:
        return [False] * TOTAL_CONDITIONS, ["N/A"] * TOTAL_CONDITIONS, 0

    close = df["Close"]
    volume = df["Volume"]

    rsi_vals = rsi(close)
    ma20 = close.rolling(MA_PERIOD, min_periods=MA_PERIOD).mean()
    vol_ma20 = volume.rolling(VOL_MA_PERIOD, min_periods=VOL_MA_PERIOD).mean()
    high20 = df["High"].rolling(MA_PERIOD, min_periods=MA_PERIOD).max()
    vol_pct = volatility_pct(close, MA_PERIOD)
    mom_1d = momentum_pct(close, 1)
    mom_5d = (close.iloc[row_index] / close.iloc[row_index - 5] - 1.0) if row_index >= 5 else 0.0

    r = row_index
    rsi_r = rsi_vals.iloc[r] if pd.notna(rsi_vals.iloc[r]) else 50
    vol_r = vol_pct.iloc[r] if pd.notna(vol_pct.iloc[r]) else 1.0
    c1 = rsi_r < 90
    c2 = (mom_1d.iloc[r] > MOMENTUM_PCT) if pd.notna(mom_1d.iloc[r]) else False
    c3 = vol_r < VOLATILITY_PCT
    c4 = close.iloc[r] > ma20.iloc[r]
    c5 = volume.iloc[r] < (VOL_SPIKE_MULT * vol_ma20.iloc[r]) if vol_ma20.iloc[r] > 0 else True
    c6 = mom_5d > 0
    c7 = (high20.iloc[r] - close.iloc[r]) / high20.iloc[r] < HIGH_NEAR_PCT if high20.iloc[r] > 0 else False
    c8 = rsi_r > 25

    conditions = [c1, c2, c3, c4, c5, c6, c7, c8]
    labels = [
        f"RSI<90 ({rsi_r:.1f})",
        f"Momentum>1% ({mom_1d.iloc[r]*100:.2f}%)" if pd.notna(mom_1d.iloc[r]) else "Momentum>1% (N/A)",
        f"Vol<6% ({vol_r*100:.2f}%)",
        "Price>MA20",
        "Vol<2xMA20",
        "5d return>0",
        "Near 20d high",
        f"RSI>25 ({rsi_r:.1f})",
    ]
    vote_count = sum(conditions)
    return conditions, labels, vote_count


def can_enter_trade(
    is_bull_regime: bool,
    conditions_met: int,
    min_votes: int = MIN_VOTES,
) -> bool:
    """Entry allowed only if regime is Bull Run and at least min_votes (default 7) of 8 conditions met."""
    return is_bull_regime and conditions_met >= min_votes


def get_signal(
    df: pd.DataFrame,
    is_bull_regime: bool,
    row_index: int | None = None,
) -> dict:
    """
    Get full signal at given row (default: last row).
    Returns dict: can_enter, vote_count, conditions, condition_labels, is_bull_regime.
    """
    if row_index is None:
        row_index = len(df) - 1
    conditions, labels, vote_count = evaluate_conditions(df, row_index)
    can_enter = can_enter_trade(is_bull_regime, vote_count)
    return {
        "can_enter": can_enter,
        "vote_count": vote_count,
        "conditions": conditions,
        "condition_labels": labels,
        "is_bull_regime": is_bull_regime,
        "min_required": MIN_VOTES,
    }
