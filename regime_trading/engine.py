"""
Core regime engine: 7-state Gaussian HMM on 3 features (returns, range, volume volatility).
Auto-labels Bull Run (highest mean return) and Bear/Crash (lowest mean return).
"""

import numpy as np
import pandas as pd
from hmmlearn import hmm


# Number of hidden states (regime components)
N_COMPONENTS = 7

# Rolling window for volatility features
VOL_WINDOW = 20


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build 3 features for HMM from OHLCV:
    1. Returns: daily close-to-close simple return (as decimal, e.g. 0.01 = 1%)
    2. Range: (High - Low) / Close for that day (normalized range)
    3. Volume volatility: rolling std of volume over VOL_WINDOW, normalized (e.g. z-score or pct of mean)
    Returns a DataFrame with same index as df (first VOL_WINDOW rows may have NaN for vol).
    """
    close = df["Close"]
    returns = close.pct_change().fillna(0).values
    range_pct = ((df["High"] - df["Low"]) / close.replace(0, np.nan)).fillna(0).values
    vol = df["Volume"].values.astype(float)
    vol_roll_std = pd.Series(vol).rolling(VOL_WINDOW, min_periods=VOL_WINDOW).std().values
    vol_mean = pd.Series(vol).rolling(VOL_WINDOW, min_periods=VOL_WINDOW).mean().values
    # Volume volatility: coefficient of variation (std/mean) so it's scale-free
    vol_vol = np.where(vol_mean > 0, vol_roll_std / vol_mean, 0.0)
    # Replace NaN in first window with 0
    vol_vol = np.nan_to_num(vol_vol, nan=0.0, posinf=0.0, neginf=0.0)

    out = pd.DataFrame(
        {
            "returns": returns,
            "range": range_pct,
            "volume_volatility": vol_vol,
        },
        index=df.index,
    )
    return out


def fit_hmm(
    X: np.ndarray,
    n_components: int = N_COMPONENTS,
    random_state: int = 42,
) -> tuple[hmm.GaussianHMM, np.ndarray]:
    """
    Fit Gaussian HMM on observation matrix X (T x 3).
    Returns (fitted model, state sequence for X).
    """
    model = hmm.GaussianHMM(
        n_components=n_components,
        covariance_type="full",
        n_iter=200,
        random_state=random_state,
    )
    model.fit(X)
    states = model.predict(X)
    return model, states


def label_regimes(
    states: np.ndarray,
    returns: np.ndarray,
) -> tuple[dict[int, str], int, int]:
    """
    Auto-detect Bull Run (highest mean return) and Bear/Crash (lowest mean return).
    returns: 1d array of daily returns aligned with states.
    Returns (state_id -> label dict, bull_state_id, bear_state_id).
    """
    n = len(np.unique(states))
    mean_return_by_state = {}
    for s in range(n):
        mask = states == s
        if mask.sum() > 0:
            mean_return_by_state[s] = np.mean(returns[mask])
        else:
            mean_return_by_state[s] = 0.0

    sorted_states = sorted(mean_return_by_state.keys(), key=lambda k: mean_return_by_state[k])
    bear_state = sorted_states[0]
    bull_state = sorted_states[-1]

    labels = {}
    for s in range(n):
        if s == bull_state:
            labels[s] = "Bull Run"
        elif s == bear_state:
            labels[s] = "Bear/Crash"
        else:
            labels[s] = f"Regime_{s}"
    return labels, bull_state, bear_state


def run_regime_pipeline(
    df: pd.DataFrame,
    n_components: int = N_COMPONENTS,
    random_state: int = 42,
) -> dict:
    """
    Full pipeline: build features, drop rows with NaN, fit HMM, label states.
    Returns dict with:
      model, states, labels, bull_state, bear_state, features_df, current_regime
    """
    feats = build_features(df)
    # Drop rows where any feature is NaN (e.g. first VOL_WINDOW for vol vol)
    valid = feats.dropna()
    if len(valid) < 200:
        raise ValueError(f"Too few valid rows for HMM: {len(valid)}")
    X = valid[["returns", "range", "volume_volatility"]].values

    model, states = fit_hmm(X, n_components=n_components, random_state=random_state)
    returns_used = valid["returns"].values
    state_labels, bull_state, bear_state = label_regimes(states, returns_used)

    current_state = int(states[-1])
    current_regime = state_labels[current_state]

    return {
        "model": model,
        "states": states,
        "state_labels": state_labels,
        "bull_state": bull_state,
        "bear_state": bear_state,
        "features_df": valid,
        "current_regime": current_regime,
        "current_state": current_state,
        "is_bull": current_state == bull_state,
        "is_bear": current_state == bear_state,
    }
