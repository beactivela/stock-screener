"""
Professional regime-based trading app (Streamlit).
- Data: yfinance (SPY, QQQ, or custom ticker)
- Engine: hmmlearn GaussianHMM, 7 components, 3 features (returns, range, volume volatility)
- Auto Bull Run / Bear Crash detection
- Entry: only when regime is Bull Run and ≥7 of 8 confirmations met
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta

from data import fetch_ohlcv
from engine import run_regime_pipeline, build_features
from strategy import get_signal, MIN_VOTES, TOTAL_CONDITIONS


st.set_page_config(page_title="Regime Trading", layout="wide")
st.title("Regime-based trading")
st.caption("7-state HMM on returns, range, volume volatility · Entry when Bull Run + ≥7/8 confirmations")

# Sidebar: ticker and training
with st.sidebar:
    st.header("Data & model")
    ticker = st.text_input("Ticker", value="SPY").strip().upper() or "SPY"
    years = st.slider("Years of history", 2, 10, 5)
    if st.button("Fetch data & train HMM"):
        with st.spinner("Fetching and training…"):
            try:
                df = fetch_ohlcv(ticker, years=years)
                result = run_regime_pipeline(df, n_components=7, random_state=42)
                st.session_state["df"] = df
                st.session_state["regime_result"] = result
                st.session_state["ticker"] = ticker
                st.success(f"Trained on {len(df)} days. Current regime: **{result['current_regime']}**")
            except Exception as e:
                st.error(str(e))
    st.divider()
    st.markdown("**Entry rule:** HMM regime = Bull Run and **≥7 of 8** conditions met.")

# Main area
if "regime_result" not in st.session_state:
    st.info("Use the sidebar to pick a ticker and click **Fetch data & train HMM** to start.")
    st.stop()

df = st.session_state["df"]
result = st.session_state["regime_result"]
ticker = st.session_state.get("ticker", "SPY")

# Current regime and signal
col1, col2, col3 = st.columns(3)
with col1:
    st.metric("Current regime", result["current_regime"])
with col2:
    signal = get_signal(df, result["is_bull"])
    st.metric("Confirmations", f"{signal['vote_count']}/{TOTAL_CONDITIONS}")
with col3:
    can_enter = signal["can_enter"]
    st.metric("Ready to enter", "Yes" if can_enter else "No")

if can_enter:
    st.success("Entry conditions met: Bull regime and ≥7 confirmations.")
else:
    st.warning("Do not enter: regime is not Bull Run and/or fewer than 7 confirmations.")

# 8 conditions table
st.subheader("Eight confirmations")
cond_df = pd.DataFrame({
    "Condition": [
        "RSI < 90%",
        "Momentum > 1%",
        "Volatility < 6%",
        "Price > MA20",
        "Volume < 2× MA20",
        "5-day return > 0",
        "Within 5% of 20d high",
        "RSI > 25",
    ],
    "Detail": signal["condition_labels"],
    "Pass": signal["conditions"],
})
cond_df["Pass"] = cond_df["Pass"].map({True: "Yes", False: "No"})
st.dataframe(cond_df, use_container_width=True, hide_index=True)

# Regime timeline
st.subheader("Regime over time")
feats = result["features_df"]
states = result["states"]
labels = result["state_labels"]
regime_series = pd.Series([labels[s] for s in states], index=feats.index)
plot_df = df.loc[feats.index].copy()
plot_df["Regime"] = regime_series
plot_df["State"] = states

fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.06, row_heights=[0.6, 0.4])
fig.add_trace(go.Scatter(x=plot_df.index, y=plot_df["Close"], name="Close", line=dict(color="blue")), row=1, col=1)
fig.add_trace(go.Scatter(x=plot_df.index, y=plot_df["State"], name="State (0=Bear..6=Bull)", line=dict(color="green", width=1)), row=2, col=1)
fig.update_layout(height=500, title_text=f"{ticker} price and HMM state")
fig.update_yaxes(title_text="Price", row=1, col=1)
fig.update_yaxes(title_text="State", row=2, col=1)
st.plotly_chart(fig, use_container_width=True)

# State labels summary
st.subheader("Regime states (auto-labeled)")
st.markdown(f"**Bull Run** = state {result['bull_state']} (highest mean return) · **Bear/Crash** = state {result['bear_state']} (lowest mean return)")
st.json(result["state_labels"])
