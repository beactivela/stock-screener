/**
 * Drawdown reversal study: ≥20% drawdown from rolling N-day high, swing pivots,
 * MA/volume signals, weekly context (as-of), forward returns at 21/63/126 sessions.
 *
 * Episode definition (locked for reproducibility):
 * - Reference high = rolling max of **high** over `rollingHighDays` (default 252).
 * - Drawdown % = (refHigh - close) / refHigh using same-day refHigh.
 * - Episode **start**: first index i where DD ≥ threshold and DD at i−1 < threshold (crossing).
 * - Episode **peakRef**: refHigh at index i on the start bar (the trailing high that defines the drop).
 * - Episode **end**: first index j > start where close[j] ≥ peakRef (full reclaim of that peak), else last bar.
 */

import fs from 'fs/promises';
import path from 'path';

import { loadTickers } from './db/tickers.js';
import { getBarsBatch } from './db/bars.js';

/** @type {const} */
export const DEFAULT_STUDY_SPEC = {
  rollingHighDays: 252,
  drawdownThreshold: 0.2,
  /** Minimum bars before an episode can start (need full rolling window + 1 for crossing) */
  minBars: 260,
  minEpisodeBars: 5,
  pivotK: 5,
  pivotKAlt: 3,
  forwardHorizons: [21, 63, 126],
  smaPeriods: [10, 20, 50],
  volumeLookback: 50,
  volumeSpikeRatio: 1.5,
  /** Weekly SMA length for "close above 10-week MA" style signal */
  weeklySmaWeeks: 10,
};

export function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toDateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function maxInRange(bars, start, end, field = 'h') {
  let out = -Infinity;
  for (let i = start; i <= end; i++) {
    if (i < 0 || i >= bars.length) continue;
    const value = toNum(bars[i]?.[field]);
    if (value != null && value > out) out = value;
  }
  return Number.isFinite(out) ? out : null;
}

export function minInRange(bars, start, end, field = 'c') {
  let out = Infinity;
  for (let i = start; i <= end; i++) {
    if (i < 0 || i >= bars.length) continue;
    const value = toNum(bars[i]?.[field]);
    if (value != null && value < out) out = value;
  }
  return Number.isFinite(out) ? out : null;
}

export function smaAt(bars, index, length, field = 'c') {
  if (index - length + 1 < 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = index - length + 1; i <= index; i++) {
    const value = toNum(bars[i]?.[field]);
    if (value == null) return null;
    sum += value;
    count += 1;
  }
  if (count !== length) return null;
  return sum / length;
}

export function avgVolumeAt(bars, index, length = 50) {
  return smaAt(bars, index, length, 'v');
}

/**
 * Rolling high at `index`: max of `field` over [index - window + 1, index].
 */
export function rollingHighAt(bars, index, window, field = 'h') {
  return maxInRange(bars, index - window + 1, index, field);
}

export function drawdownPctAt(bars, index, window) {
  const rh = rollingHighAt(bars, index, window, 'h');
  const close = toNum(bars[index]?.c);
  if (rh == null || rh <= 0 || close == null) return null;
  return (rh - close) / rh;
}

/**
 * @returns {{ start: number, end: number, peakRef: number, startDate: string }[]}
 */
export function findDrawdownEpisodes(bars, options = {}) {
  const {
    rollingHighDays = DEFAULT_STUDY_SPEC.rollingHighDays,
    drawdownThreshold = DEFAULT_STUDY_SPEC.drawdownThreshold,
    minIndex = DEFAULT_STUDY_SPEC.minBars - 1,
    minEpisodeBars = DEFAULT_STUDY_SPEC.minEpisodeBars,
  } = options;

  if (!Array.isArray(bars) || bars.length < minIndex + 2) return [];

  const episodes = [];
  let inEpisode = false;
  let start = -1;
  let peakRef = 0;

  const ddAt = (idx) => drawdownPctAt(bars, idx, rollingHighDays);

  const startI = Math.max(rollingHighDays - 1, minIndex);
  for (let i = startI; i < bars.length; i++) {
    const dd = ddAt(i);
    const prevDd = ddAt(i - 1);
    if (dd == null || prevDd == null) continue;

    const close = toNum(bars[i]?.c);
    const rh = rollingHighAt(bars, i, rollingHighDays, 'h');
    if (close == null || rh == null) continue;

    if (!inEpisode && dd >= drawdownThreshold && prevDd < drawdownThreshold) {
      inEpisode = true;
      start = i;
      peakRef = rh;
    } else if (inEpisode && close >= peakRef) {
      const end = i;
      if (end - start + 1 >= minEpisodeBars) {
        episodes.push({
          start,
          end,
          peakRef,
          startDate: toDateStr(bars[start].t),
        });
      }
      inEpisode = false;
    }
  }

  if (inEpisode && start >= 0) {
    const end = bars.length - 1;
    if (end - start + 1 >= minEpisodeBars) {
      episodes.push({
        start,
        end,
        peakRef,
        startDate: toDateStr(bars[start].t),
      });
    }
  }

  return episodes;
}

/** Fractal pivot: index is minimum low in [i-k, i+k]. */
export function isPivotLow(bars, i, k) {
  if (i - k < 0 || i + k >= bars.length) return false;
  let minVal = Infinity;
  let minIdx = -1;
  for (let j = i - k; j <= i + k; j++) {
    const lj = toNum(bars[j]?.l);
    if (lj == null) return false;
    if (lj < minVal) {
      minVal = lj;
      minIdx = j;
    }
  }
  return minIdx === i;
}

export function isPivotHigh(bars, i, k) {
  if (i - k < 0 || i + k >= bars.length) return false;
  let maxVal = -Infinity;
  let maxIdx = -1;
  for (let j = i - k; j <= i + k; j++) {
    const hj = toNum(bars[j]?.h);
    if (hj == null) return false;
    if (hj > maxVal) {
      maxVal = hj;
      maxIdx = j;
    }
  }
  return maxIdx === i;
}

/** All pivot low indices in range [from, to] inclusive. */
export function pivotLowsInRange(bars, from, to, k) {
  const out = [];
  for (let i = from + k; i <= to - k; i++) {
    if (isPivotLow(bars, i, k)) out.push(i);
  }
  return out;
}

export function argminClose(bars, from, to) {
  let best = from;
  let bestVal = Infinity;
  for (let i = from; i <= to && i < bars.length; i++) {
    const c = toNum(bars[i]?.c);
    if (c != null && c < bestVal) {
      bestVal = c;
      best = i;
    }
  }
  return best;
}

/**
 * Count pivot lows after trough where each pivot low is strictly higher than the prior counted pivot.
 */
export function countHigherLowsAfterTrough(bars, troughIndex, endIndex, k) {
  const pivots = pivotLowsInRange(bars, troughIndex, endIndex, k).filter((idx) => idx > troughIndex);
  if (pivots.length === 0) return { count: 0, pivotIndices: [] };
  const seq = [pivots[0]];
  for (let p = 1; p < pivots.length; p++) {
    const prevLow = toNum(bars[seq[seq.length - 1]]?.l);
    const curLow = toNum(bars[pivots[p]]?.l);
    if (prevLow != null && curLow != null && curLow > prevLow) seq.push(pivots[p]);
  }
  return { count: Math.max(0, seq.length - 1), pivotIndices: seq };
}

export function forwardCloseReturnPct(bars, fromIndex, horizon) {
  const c0 = toNum(bars[fromIndex]?.c);
  const c1 = toNum(bars[fromIndex + horizon]?.c);
  if (c0 == null || c1 == null || c0 === 0) return null;
  return ((c1 - c0) / c0) * 100;
}

/**
 * Map each daily index to { weekIndex, weekCloseAboveSma10 } using weekly bars aligned as-of (no future week leak).
 * weekly bars sorted ascending by t.
 */
export function buildWeeklyStateAsOf(dailyBars, weeklyBars, weeklySmaWeeks = 10) {
  const dailyWeekIndex = new Array(dailyBars.length).fill(-1);
  const dailyAboveWeeklySma = new Array(dailyBars.length).fill(null);

  if (!Array.isArray(weeklyBars) || weeklyBars.length < weeklySmaWeeks + 1) {
    return { dailyWeekIndex, dailyAboveWeeklySma };
  }

  const wSma = new Array(weeklyBars.length).fill(null);
  for (let i = weeklySmaWeeks - 1; i < weeklyBars.length; i++) {
    wSma[i] = smaAt(weeklyBars, i, weeklySmaWeeks, 'c');
  }

  let wCursor = 0;
  for (let d = 0; d < dailyBars.length; d++) {
    const dt = dailyBars[d]?.t;
    if (dt == null) continue;
    while (wCursor + 1 < weeklyBars.length && weeklyBars[wCursor + 1].t <= dt) {
      wCursor += 1;
    }
    dailyWeekIndex[d] = wCursor;
    const wc = toNum(weeklyBars[wCursor]?.c);
    const sma = wSma[wCursor];
    if (wc != null && sma != null) dailyAboveWeeklySma[d] = wc > sma;
    else dailyAboveWeeklySma[d] = null;
  }

  return { dailyWeekIndex, dailyAboveWeeklySma };
}

function firstIndexWhere(bars, from, to, pred) {
  for (let i = from; i <= to && i < bars.length; i++) {
    if (pred(i)) return i;
  }
  return null;
}

/**
 * Per-episode signal dates (first occurrence after episode start, before end).
 */
export function computeEpisodeSignals(bars, episode, weeklyState, options = {}) {
  const {
    volumeLookback = DEFAULT_STUDY_SPEC.volumeLookback,
    volumeSpikeRatio = DEFAULT_STUDY_SPEC.volumeSpikeRatio,
    pivotK = DEFAULT_STUDY_SPEC.pivotK,
  } = options;

  const { start, end } = episode;
  const troughIndex = argminClose(bars, start, end);

  const sma10Above = (i) => {
    const s = smaAt(bars, i, 10);
    const c = toNum(bars[i]?.c);
    return s != null && c != null && c > s;
  };
  const sma20Above = (i) => {
    const s = smaAt(bars, i, 20);
    const c = toNum(bars[i]?.c);
    return s != null && c != null && c > s;
  };
  const sma50Above = (i) => {
    const s = smaAt(bars, i, 50);
    const c = toNum(bars[i]?.c);
    return s != null && c != null && c > s;
  };

  const firstCloseAboveSma10 = firstIndexWhere(bars, start, end, (i) => sma10Above(i));
  const firstCloseAboveSma20 = firstIndexWhere(bars, start, end, (i) => sma20Above(i));
  const firstCloseAboveSma50 = firstIndexWhere(bars, start, end, (i) => sma50Above(i));

  const cross10over20 = firstIndexWhere(bars, start + 1, end, (i) => {
    const s10 = smaAt(bars, i, 10);
    const s20 = smaAt(bars, i, 20);
    const s10p = smaAt(bars, i - 1, 10);
    const s20p = smaAt(bars, i - 1, 20);
    return s10 != null && s20 != null && s10p != null && s20p != null && s10 > s20 && s10p <= s20p;
  });

  const volSpike = firstIndexWhere(bars, start, end, (i) => {
    if (i < 1) return false;
    const v = toNum(bars[i]?.v);
    const av = avgVolumeAt(bars, i - 1, volumeLookback);
    return v != null && av != null && av > 0 && v >= av * volumeSpikeRatio;
  });

  const hlInfo = countHigherLowsAfterTrough(bars, troughIndex, end, pivotK);

  let firstWeeklyAboveSma = null;
  if (weeklyState?.dailyAboveWeeklySma) {
    firstWeeklyAboveSma = firstIndexWhere(bars, start, end, (i) => weeklyState.dailyAboveWeeklySma[i] === true);
  }

  return {
    troughIndex,
    higherLowCount: hlInfo.count,
    firstCloseAboveSma10,
    firstCloseAboveSma20,
    firstCloseAboveSma50,
    sma10CrossAboveSma20: cross10over20,
    volumeSpikeIndex: volSpike,
    firstWeeklyCloseAboveSma10: firstWeeklyAboveSma,
  };
}

export function forwardReturnsForHorizons(bars, signalIndex, horizons) {
  const out = {};
  if (signalIndex == null) return out;
  for (const h of horizons) {
    if (signalIndex + h < bars.length) {
      const r = forwardCloseReturnPct(bars, signalIndex, h);
      out[`fwd_${h}d_pct`] = r;
    } else {
      out[`fwd_${h}d_pct`] = null;
    }
  }
  return out;
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function percentile(values, p) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = (p / 100) * (nums.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  return nums[lo] * (hi - idx) + nums[hi] * (idx - lo);
}

/**
 * Aggregate forward returns for a named signal across episode rows.
 */
export function summarizeSignalForwards(rows, signalKey, horizons = DEFAULT_STUDY_SPEC.forwardHorizons) {
  const collected = {};
  for (const h of horizons) collected[h] = [];

  for (const row of rows) {
    const sigIdx = row.signals?.[signalKey];
    if (sigIdx == null) continue;
    const fwd = forwardReturnsForHorizons(row.bars || [], sigIdx, horizons);
    for (const h of horizons) {
      const v = fwd[`fwd_${h}d_pct`];
      if (v != null) collected[h].push(v);
    }
  }

  const byHorizon = {};
  for (const h of horizons) {
    const arr = collected[h];
    byHorizon[`h${h}`] = {
      n: arr.length,
      median: median(arr),
      p25: percentile(arr, 25),
      p75: percentile(arr, 75),
    };
  }
  return byHorizon;
}

/**
 * Baseline: forward returns from episode **start** bar (first day in ≥20% drawdown).
 */
export function summarizeBaselineFromEpisodeStart(rows, horizons = DEFAULT_STUDY_SPEC.forwardHorizons) {
  const collected = {};
  for (const h of horizons) collected[h] = [];

  for (const row of rows) {
    const start = row.episode?.start;
    if (start == null || !row.bars) continue;
    for (const h of horizons) {
      const v = forwardCloseReturnPct(row.bars, start, h);
      if (v != null) collected[h].push(v);
    }
  }

  const byHorizon = {};
  for (const h of horizons) {
    const arr = collected[h];
    byHorizon[`h${h}`] = {
      n: arr.length,
      median: median(arr),
      p25: percentile(arr, 25),
      p75: percentile(arr, 75),
    };
  }
  return byHorizon;
}

/**
 * Analyze one ticker: episodes + signals + forward returns (for first SMA20 reclaim as primary).
 */
export function analyzeTickerDrawdowns(ticker, dailyBars, weeklyBars, options = {}) {
  const spec = { ...DEFAULT_STUDY_SPEC, ...options };
  const horizons = spec.forwardHorizons || DEFAULT_STUDY_SPEC.forwardHorizons;

  const sorted = [...dailyBars].sort((a, b) => toNum(a.t) - toNum(b.t));
  const sortedW = weeklyBars ? [...weeklyBars].sort((a, b) => toNum(a.t) - toNum(b.t)) : [];

  const weeklyState = buildWeeklyStateAsOf(sorted, sortedW, spec.weeklySmaWeeks);
  const episodes = findDrawdownEpisodes(sorted, {
    rollingHighDays: spec.rollingHighDays,
    drawdownThreshold: spec.drawdownThreshold,
    minIndex: spec.minBars - 1,
    minEpisodeBars: spec.minEpisodeBars,
  });

  const rows = [];
  for (const ep of episodes) {
    const signals = computeEpisodeSignals(sorted, ep, weeklyState, spec);
    const primaryIdx = signals.firstCloseAboveSma20;
    const forwardsPrimary = primaryIdx != null ? forwardReturnsForHorizons(sorted, primaryIdx, horizons) : {};
    const forwardsStart = forwardReturnsForHorizons(sorted, ep.start, horizons);

    rows.push({
      ticker,
      episode: ep,
      signals,
      forwardsFromSma20Reclaim: forwardsPrimary,
      forwardsFromEpisodeStart: forwardsStart,
      bars: sorted,
    });
  }

  return { ticker, episodes, rows, weeklyState };
}

async function loadBarsForUniverse(tickers, from, to, interval, options = {}) {
  const chunkSize = Math.max(50, Number(options.chunkSize) || 200);
  const concurrency = Math.max(1, Number(options.concurrency) || 8);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const byTicker = new Map();
  let processed = 0;

  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    const requests = chunk.map((ticker) => ({ ticker, from, to, interval }));
    const rows = await getBarsBatch(requests, { concurrency });
    for (const row of rows || []) {
      if (row?.status === 'fulfilled' && row?.ticker && Array.isArray(row?.bars) && row.bars.length > 0) {
        byTicker.set(row.ticker, row.bars);
      }
      processed += 1;
      if (onProgress && processed % 100 === 0) {
        onProgress({ stage: 'bars', interval, processed, total: tickers.length, loaded: byTicker.size });
      }
    }
  }
  if (onProgress) onProgress({ stage: 'bars', interval, processed: tickers.length, total: tickers.length, loaded: byTicker.size });
  return byTicker;
}

function buildMarkdownReport(study) {
  const lines = [];
  lines.push('# Drawdown reversal study (≥20% from rolling high)');
  lines.push('');
  lines.push(`Generated: ${study.generatedAt}`);
  lines.push(`Universe: ${study.meta.universeCount} tickers | Bars: ${study.meta.barsRange.from} → ${study.meta.barsRange.to}`);
  lines.push('');
  lines.push('## Method (locked)');
  lines.push('');
  lines.push(`- Rolling high: ${study.meta.methodology.rollingHighDays} sessions (high).`);
  lines.push(`- Drawdown: ≥ ${(study.meta.methodology.drawdownThreshold * 100).toFixed(0)}% from same-day rolling high; episode starts on **cross** into drawdown.`);
  lines.push('- Episode ends on first close ≥ reference peak (trailing high at episode start), or last bar if not reclaimed.');
  lines.push(`- Forward horizons: ${study.meta.methodology.forwardHorizons.join(', ')} trading sessions.`);
  lines.push(`- Pivots: k=${study.meta.methodology.pivotK} (fractal lows).`);
  lines.push('- Weekly: close > 10-week SMA on last completed week as-of each day.');
  lines.push('');
  lines.push('## Episode counts');
  lines.push('');
  lines.push(`- Total episodes: **${study.aggregates.totalEpisodes}**`);
  lines.push(`- Tickers with ≥1 episode: **${study.aggregates.tickersWithEpisodes}**`);
  lines.push('');
  lines.push('## Baseline forward returns (from episode start bar)');
  lines.push('');
  lines.push('| Horizon | N | Median % | P25 | P75 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [key, v] of Object.entries(study.aggregates.baselineByHorizon || {})) {
    lines.push(`| ${key} | ${v.n} | ${v.median != null ? v.median.toFixed(2) : 'n/a'} | ${v.p25 != null ? v.p25.toFixed(2) : 'n/a'} | ${v.p75 != null ? v.p75.toFixed(2) : 'n/a'} |`);
  }
  lines.push('');
  lines.push('## Signal-conditioned: first close above SMA20 (within episode)');
  lines.push('');
  lines.push('| Horizon | N | Median % | P25 | P75 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [key, v] of Object.entries(study.aggregates.firstCloseAboveSma20 || {})) {
    lines.push(`| ${key} | ${v.n} | ${v.median != null ? v.median.toFixed(2) : 'n/a'} | ${v.p25 != null ? v.p25.toFixed(2) : 'n/a'} | ${v.p75 != null ? v.p75.toFixed(2) : 'n/a'} |`);
  }
  lines.push('');
  lines.push('## Signal-conditioned: first close above SMA10');
  lines.push('');
  lines.push('| Horizon | N | Median % | P25 | P75 |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [key, v] of Object.entries(study.aggregates.firstCloseAboveSma10 || {})) {
    lines.push(`| ${key} | ${v.n} | ${v.median != null ? v.median.toFixed(2) : 'n/a'} | ${v.p25 != null ? v.p25.toFixed(2) : 'n/a'} | ${v.p75 != null ? v.p75.toFixed(2) : 'n/a'} |`);
  }
  lines.push('');
  lines.push('## Higher lows after trough (pivot k)');
  lines.push('');
  lines.push(`- Median count: **${study.aggregates.medianHigherLowCount ?? 'n/a'}**`);
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  lines.push('- Universe may be survivor-biased (current listings). Descriptive stats, not guaranteed edge.');
  lines.push('- Multiple signals overlap; do not treat rows as independent.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function nowDateStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {object} options
 * @param {string} [options.from] - YYYY-MM-DD
 * @param {string} [options.to]
 * @param {string[]} [options.tickers] - override universe
 * @param {number} [options.maxTickers]
 */
export async function runDrawdownReversalStudy(options = {}) {
  const spec = { ...DEFAULT_STUDY_SPEC, ...options };
  const to = options.to || nowDateStr();
  const from =
    options.from ||
    (() => {
      const d = new Date(`${to}T12:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - 5);
      return d.toISOString().slice(0, 10);
    })();

  const maxTickers = Math.max(1, Number(options.maxTickers) || 500);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  let universe = options.tickers;
  if (!universe || universe.length === 0) {
    universe = await loadTickers();
  }
  universe = universe.slice(0, maxTickers);
  if (onProgress) onProgress({ stage: 'universe', loaded: universe.length, using: universe.length });

  const dailyMap = await loadBarsForUniverse(universe, from, to, '1d', {
    concurrency: options.barsConcurrency ?? 8,
    chunkSize: options.barsChunkSize ?? 200,
    onProgress,
  });
  const weeklyMap = await loadBarsForUniverse(universe, from, to, '1wk', {
    concurrency: options.barsConcurrency ?? 8,
    chunkSize: options.barsChunkSize ?? 200,
    onProgress,
  });

  const allRows = [];
  const perTicker = [];

  for (const ticker of universe) {
    const daily = dailyMap.get(ticker);
    const weekly = weeklyMap.get(ticker);
    if (!daily || daily.length < spec.minBars) continue;

    const analyzed = analyzeTickerDrawdowns(ticker, daily, weekly || [], spec);
    for (const row of analyzed.rows) {
      allRows.push({
        ticker: row.ticker,
        episode: row.episode,
        signals: row.signals,
        forwardsFromSma20Reclaim: row.forwardsFromSma20Reclaim,
        forwardsFromEpisodeStart: row.forwardsFromEpisodeStart,
      });
    }
    perTicker.push({
      ticker,
      episodeCount: analyzed.episodes.length,
    });
  }

  const horizons = spec.forwardHorizons;
  const hlCounts = allRows.map((r) => r.signals?.higherLowCount).filter((x) => typeof x === 'number');

  const aggregates = {
    totalEpisodes: allRows.length,
    tickersWithEpisodes: perTicker.filter((p) => p.episodeCount > 0).length,
    baselineByHorizon: summarizeBaselineFromEpisodeStart(
      allRows.map((r) => ({ episode: r.episode, bars: dailyMap.get(r.ticker) })),
      horizons
    ),
    firstCloseAboveSma20: summarizeSignalForwards(
      allRows.map((r) => ({
        signals: { firstCloseAboveSma20: r.signals.firstCloseAboveSma20 },
        bars: dailyMap.get(r.ticker),
      })),
      'firstCloseAboveSma20',
      horizons
    ),
    firstCloseAboveSma10: summarizeSignalForwards(
      allRows.map((r) => ({
        signals: { firstCloseAboveSma10: r.signals.firstCloseAboveSma10 },
        bars: dailyMap.get(r.ticker),
      })),
      'firstCloseAboveSma10',
      horizons
    ),
    medianHigherLowCount: median(hlCounts),
  };

  const study = {
    generatedAt: new Date().toISOString(),
    meta: {
      dateGenerated: nowDateStr(),
      universeCount: universe.length,
      barsLoadedDaily: dailyMap.size,
      barsRange: { from, to },
      methodology: {
        rollingHighDays: spec.rollingHighDays,
        drawdownThreshold: spec.drawdownThreshold,
        forwardHorizons: horizons,
        pivotK: spec.pivotK,
        volumeSpikeRatio: spec.volumeSpikeRatio,
      },
    },
    aggregates,
    rows: allRows,
    perTickerSummary: perTicker,
  };

  if (options.outputDir) {
    const base = options.outputDir;
    const stamp = new Date().toISOString().slice(0, 10);
    const jsonPath = path.join(base, `drawdown-reversal-${stamp}.json`);
    const mdPath = path.join(base, `drawdown-reversal-${stamp}.md`);
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(study, null, 2), 'utf8');
    await fs.writeFile(mdPath, buildMarkdownReport(study), 'utf8');
    study.outputs = { jsonPath, mdPath };
  }

  return study;
}
