import argparse
import json
import sys


def safe_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def get_stat(stats, keys, default=0.0):
    for key in keys:
        if key in stats:
            return safe_float(stats[key], default)
    return default


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    try:
        import pandas as pd
        import vectorbt as vbt
    except Exception as exc:
        print(json.dumps({"error": f"vectorbt import failed: {exc}"}))
        sys.exit(1)

    with open(args.input, "r") as f:
        payload = json.load(f)

    series = payload.get("series", {})
    if not series:
        print(json.dumps({"error": "No series provided"}))
        sys.exit(1)

    price_series = []
    entry_series = []
    exit_series = []

    for ticker, data in series.items():
        dates = data.get("dates", [])
        closes = data.get("close", [])
        entries = data.get("entries", [])
        exits = data.get("exits", [])

        if not dates or not closes:
            continue

        idx = pd.to_datetime(dates)
        price_series.append(pd.Series(closes, index=idx, name=ticker))
        entry_series.append(pd.Series([bool(x) for x in entries], index=idx, name=ticker))
        exit_series.append(pd.Series([bool(x) for x in exits], index=idx, name=ticker))

    if len(price_series) == 0:
        print(json.dumps({"error": "No valid price series"}))
        sys.exit(1)

    prices = pd.concat(price_series, axis=1).sort_index()
    entries = pd.concat(entry_series, axis=1).reindex(prices.index).fillna(False)
    exits = pd.concat(exit_series, axis=1).reindex(prices.index).fillna(False)

    init_cash = safe_float(payload.get("init_cash"), 100000.0)
    fees = safe_float(payload.get("fees"), 0.0)
    slippage = safe_float(payload.get("slippage"), 0.0)

    if entries.sum().sum() == 0:
        print(json.dumps({
            "metrics": {
                "total_return_pct": 0.0,
                "cagr_pct": 0.0,
                "sharpe": 0.0,
                "max_drawdown_pct": 0.0,
                "win_rate_pct": 0.0,
            },
            "warning": "No entries found",
        }))
        return

    portfolio = vbt.Portfolio.from_signals(
        prices,
        entries,
        exits,
        init_cash=init_cash,
        fees=fees,
        slippage=slippage,
        freq="1D",
    )

    stats = portfolio.stats()
    try:
        win_rate = get_stat(stats, ["Win Rate [%]"], default=0.0)
    except Exception:
        win_rate = 0.0

    metrics = {
        "total_return_pct": get_stat(stats, ["Total Return [%]"], default=0.0),
        "cagr_pct": get_stat(stats, ["CAGR [%]"], default=0.0),
        "sharpe": get_stat(stats, ["Sharpe Ratio"], default=0.0),
        "max_drawdown_pct": get_stat(stats, ["Max Drawdown [%]"], default=0.0),
        "win_rate_pct": win_rate,
    }

    print(json.dumps({
        "metrics": metrics,
        "meta": {
            "total_trades": safe_float(stats.get("Total Trades", 0.0)),
        },
    }))


if __name__ == "__main__":
    main()
