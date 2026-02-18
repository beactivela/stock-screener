# Regime-based trading app (Streamlit)

Professional regime detection and entry logic:

- **Data:** yfinance (SPY, QQQ, or any ticker)
- **Engine:** hmmlearn **GaussianHMM** with **7 components**, trained on 3 features:
  1. **Returns** (daily close-to-close)
  2. **Range** (high − low) / close
  3. **Volume volatility** (rolling coefficient of variation of volume)
- **Auto-labels:** **Bull Run** = state with highest mean return; **Bear/Crash** = state with lowest mean return
- **Entry rule:** Enter only when **HMM regime is Bull Run** and **≥7 of 8** confirmations are met

## 8 confirmations (voting)

| # | Condition        | Description                    |
|---|------------------|--------------------------------|
| 1 | RSI < 90         | Not overbought                |
| 2 | Momentum > 1%    | Positive 1-day momentum       |
| 3 | Volatility < 6%  | 20d annualized vol < 6%       |
| 4 | Price > MA20     | Above 20-day moving average   |
| 5 | Volume < 2× MA20| No blow-off volume            |
| 6 | 5d return > 0   | Short-term trend up           |
| 7 | Near 20d high    | Close within 5% of 20d high   |
| 8 | RSI > 25         | Not deeply oversold           |

## Setup and run

```bash
cd regime_trading
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

Or with the run script (uses venv if present):

```bash
./run.sh
```

Open the URL shown (default http://localhost:8501). Use the sidebar to choose a ticker (e.g. SPY or QQQ), years of history, then **Fetch data & train HMM**. The app shows current regime, the 8 conditions, vote count, and whether entry is allowed.
