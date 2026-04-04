# Drawdown reversal study (≥20% from rolling high)

Generated: 2026-04-03T04:52:41.569Z
Universe: 2 tickers | Bars: 2021-04-03 → 2026-04-03

## Method (locked)

- Rolling high: 252 sessions (high).
- Drawdown: ≥ 20% from same-day rolling high; episode starts on **cross** into drawdown.
- Episode ends on first close ≥ reference peak (trailing high at episode start), or last bar if not reclaimed.
- Forward horizons: 21, 63, 126 trading sessions.
- Pivots: k=5 (fractal lows).
- Weekly: close > 10-week SMA on last completed week as-of each day.

## Episode counts

- Total episodes: **3**
- Tickers with ≥1 episode: **2**

## Baseline forward returns (from episode start bar)

| Horizon | N | Median % | P25 | P75 |
|---|---:|---:|---:|---:|
| h21 | 3 | -2.12 | -4.80 | -0.67 |
| h63 | 3 | 4.83 | 4.08 | 12.77 |
| h126 | 3 | 6.39 | 4.70 | 16.69 |

## Signal-conditioned: first close above SMA20 (within episode)

| Horizon | N | Median % | P25 | P75 |
|---|---:|---:|---:|---:|
| h21 | 3 | -1.58 | -4.27 | 2.35 |
| h63 | 3 | 4.48 | 0.71 | 6.16 |
| h126 | 3 | -2.47 | -3.05 | 11.92 |

## Signal-conditioned: first close above SMA10

| Horizon | N | Median % | P25 | P75 |
|---|---:|---:|---:|---:|
| h21 | 3 | 4.63 | 0.11 | 4.74 |
| h63 | 3 | 3.77 | 1.38 | 8.79 |
| h126 | 3 | 3.01 | 2.59 | 12.68 |

## Higher lows after trough (pivot k)

- Median count: **6**

## Limitations

- Universe may be survivor-biased (current listings). Descriptive stats, not guaranteed edge.
- Multiple signals overlap; do not treat rows as independent.

