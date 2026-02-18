/**
 * Hidden Markov Model for market regime detection.
 * Separate models for SPY and QQQ (each 2 states, 2-D: returns + volatility).
 * Outputs current regime and forward predictions (1, 5, 14 days).
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { loadRegimeData, REGIME_DIR } from './regimeData.js';

const require = createRequire(import.meta.url);
const tf = require('@tensorflow/tfjs');
const HMM = require('hidden-markov-model-tf');

const VOL_WINDOW = 20;
const NUM_STATES = 2;
const DIMENSIONS_SINGLE = 2; // returns, volatility per ticker

/** Prediction horizons (days ahead) */
const PREDICT_DAYS = [1, 5, 14];

function dailyReturns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const r = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
    out.push({ t: bars[i].t, return: r });
  }
  return out;
}

function rollingStd(series, window) {
  const out = new Array(series.length).fill(null);
  for (let i = window - 1; i < series.length; i++) {
    const slice = series.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s, x) => s + x, 0) / window;
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / window;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

/**
 * Build 2-D features for a single ticker: [returns, volatility].
 * @param {Array<{t, o, h, l, c, v}>} bars
 * @returns {{ dates: number[], matrix: number[][] }}
 */
function buildFeaturesSingle(bars) {
  const ret = dailyReturns(bars);
  const returnArr = ret.map((x) => x.return);
  const vol = rollingStd(returnArr, VOL_WINDOW);
  const dates = [];
  const matrix = [];
  for (let i = 0; i < ret.length; i++) {
    if (vol[i] != null) {
      dates.push(ret[i].t);
      matrix.push([returnArr[i], vol[i]]);
    }
  }
  return { dates, matrix };
}

/**
 * 2x2 matrix multiply: C = A * B (row-major arrays of length 4).
 */
function mat2Mul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
  ];
}

/** A^n for 2x2 row-major A. */
function mat2Pow(A, n) {
  if (n <= 0) return [1, 0, 0, 1];
  let out = A;
  for (let i = 1; i < n; i++) out = mat2Mul(out, A);
  return out;
}

/**
 * Probability of being in state 0 and state 1 after n days: v * A^n (v = one-hot at currentState).
 * @param {number[]} A - 2x2 transition matrix (row-major)
 * @param {number} currentState - 0 or 1
 * @param {number} n - days ahead
 * @returns {[number, number]} - [p0, p1]
 */
function stateDistributionAtDay(A, currentState, n) {
  const An = mat2Pow(A, n);
  const p0 = currentState === 0 ? An[0] : An[2];
  const p1 = currentState === 0 ? An[1] : An[3];
  return [p0, p1];
}

/**
 * Build prediction object for next 1, 5, 14 days from transition matrix and current state.
 * Maps state 0/1 to bull/bear using stateToLabel.
 * @param {number[]} A - 2x2 row-major
 * @param {number} currentState
 * @param {Object} stateToLabel - e.g. { 0: 'bear', 1: 'bull' }
 * @returns {{ nextDay: { bull, bear, mostLikely }, day5, day14 }}
 */
export function predictRegimeForward(A, currentState, stateToLabel) {
  const bullState = stateToLabel[0] === 'bull' ? 0 : 1;
  const bearState = 1 - bullState;
  const out = {};
  for (const d of PREDICT_DAYS) {
    const [p0, p1] = stateDistributionAtDay(A, currentState, d);
    const bull = bullState === 0 ? p0 : p1;
    const bear = bearState === 0 ? p0 : p1;
    const key = d === 1 ? 'nextDay' : d === 5 ? 'day5' : 'day14';
    out[key] = {
      bull: Math.round(bull * 1000) / 1000,
      bear: Math.round(bear * 1000) / 1000,
      mostLikely: bull >= bear ? 'bull' : 'bear',
    };
  }
  return out;
}

/**
 * Train one HMM on a single ticker's 2-D features. Returns model params and state sequence.
 */
async function trainOne(bars, options = {}) {
  const { seed = 42, maxIterations = 200, tolerance = 1e-4 } = options;
  const { dates, matrix } = buildFeaturesSingle(bars);
  if (matrix.length < 100) throw new Error('Insufficient bars for HMM');
  const tensor = tf.tensor3d([matrix], null, 'float32');
  const hmm = new HMM({ states: NUM_STATES, dimensions: DIMENSIONS_SINGLE });
  const fitResult = await hmm.fit(tensor, { maxIterations, tolerance, seed });
  const stateTensor = hmm.inference(tensor);
  const stateData = await stateTensor.data();
  const states = Array.from(stateData).map((s) => Math.round(s));
  const { pi, A, mu, Sigma } = hmm.getParameters();
  const piArr = Array.from(await pi.data());
  const AArr = Array.from(await A.data());
  const muArr = Array.from(await mu.data());
  const SigmaArr = Array.from(await Sigma.data());
  tensor.dispose();
  stateTensor.dispose();

  const stateMeanReturn = [0, 1].map((s) => {
    let sum = 0, n = 0;
    states.forEach((st, i) => {
      if (st === s) { sum += matrix[i][0]; n++; }
    });
    return n ? sum / n : 0;
  });
  const higherState = stateMeanReturn[1] >= stateMeanReturn[0] ? 1 : 0;
  const stateToLabel = { [higherState]: 'bull', [1 - higherState]: 'bear' };
  const currentState = states[states.length - 1];
  const currentRegime = stateToLabel[currentState];

  return {
    dates,
    matrix,
    states,
    stateToLabel,
    bullState: higherState,
    bearState: 1 - higherState,
    currentRegime,
    currentState,
    pi: piArr,
    A: AArr,
    mu: muArr,
    Sigma: SigmaArr,
    converged: fitResult.converged,
  };
}

/**
 * Compute backtest: regime vs actual forward returns over the full 5y history.
 * Returns fullHistory (date, regime, state) and metrics (avg returns when bull/bear, correlations).
 */
function computeBacktestMetrics(bars, dates, states, stateToLabel) {
  const closeByT = new Map(bars.map((b) => [b.t, b.c]));
  const n = dates.length;
  const fullHistory = dates.map((t, i) => ({
    date: new Date(t).toISOString().slice(0, 10),
    regime: stateToLabel[states[i]],
    state: states[i],
  }));

  const forward1d = [];
  const forward5d = [];
  const forward21d = [];
  const regimeNum = []; // 1 = bull, 0 = bear

  for (let i = 0; i < n; i++) {
    const c0 = closeByT.get(dates[i]);
    if (c0 == null) continue;
    const c1 = i + 1 < n ? closeByT.get(dates[i + 1]) : null;
    const c5 = i + 5 < n ? closeByT.get(dates[i + 5]) : null;
    const c21 = i + 21 < n ? closeByT.get(dates[i + 21]) : null;
    const r1 = c1 != null ? (c1 - c0) / c0 : null;
    const r5 = c5 != null ? (c5 - c0) / c0 : null;
    const r21 = c21 != null ? (c21 - c0) / c0 : null;
    regimeNum.push(stateToLabel[states[i]] === 'bull' ? 1 : 0);
    forward1d.push(r1);
    forward5d.push(r5);
    forward21d.push(r21);
  }

  const bullIdx = regimeNum.map((r, i) => (r === 1 ? i : -1)).filter((i) => i >= 0);
  const bearIdx = regimeNum.map((r, i) => (r === 0 ? i : -1)).filter((i) => i >= 0);

  const avg = (arr, indices) => {
    const vals = indices.map((i) => arr[i]).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const correlation = (x, y) => {
    const valid = x.map((v, i) => (v != null && y[i] != null ? [v, y[i]] : null)).filter(Boolean);
    if (valid.length < 10) return null;
    const nv = valid.length;
    const mx = valid.reduce((s, [a]) => s + a, 0) / nv;
    const my = valid.reduce((s, [, b]) => s + b, 0) / nv;
    let sx = 0, sy = 0, sxy = 0;
    valid.forEach(([a, b]) => {
      sx += (a - mx) ** 2;
      sy += (b - my) ** 2;
      sxy += (a - mx) * (b - my);
    });
    const den = Math.sqrt(sx * sy);
    return den === 0 ? null : sxy / den;
  };

  const whenBull = {
    count: bullIdx.length,
    avgForward1dPct: avg(forward1d, bullIdx) != null ? Math.round(avg(forward1d, bullIdx) * 10000) / 100 : null,
    avgForward5dPct: avg(forward5d, bullIdx) != null ? Math.round(avg(forward5d, bullIdx) * 10000) / 100 : null,
    avgForward21dPct: avg(forward21d, bullIdx) != null ? Math.round(avg(forward21d, bullIdx) * 10000) / 100 : null,
  };
  const whenBear = {
    count: bearIdx.length,
    avgForward1dPct: avg(forward1d, bearIdx) != null ? Math.round(avg(forward1d, bearIdx) * 10000) / 100 : null,
    avgForward5dPct: avg(forward5d, bearIdx) != null ? Math.round(avg(forward5d, bearIdx) * 10000) / 100 : null,
    avgForward21dPct: avg(forward21d, bearIdx) != null ? Math.round(avg(forward21d, bearIdx) * 10000) / 100 : null,
  };

  const corr1d = correlation(regimeNum, forward1d);
  const corr5d = correlation(regimeNum, forward5d);
  const corr21d = correlation(regimeNum, forward21d);

  return {
    fullHistory,
    metrics: {
      whenBull,
      whenBear,
      correlation1d: corr1d != null ? Math.round(corr1d * 1000) / 1000 : null,
      correlation5d: corr5d != null ? Math.round(corr5d * 1000) / 1000 : null,
      correlation21d: corr21d != null ? Math.round(corr21d * 1000) / 1000 : null,
      totalDays: n,
    },
  };
}

/**
 * Train separate SPY and QQQ models, save model_*.json, current_*.json, and backtest_*.json.
 */
export async function trainAndSave(options = {}) {
  const data = loadRegimeData();
  if (!data?.spy?.length || !data?.qqq?.length) {
    throw new Error('Regime data not found. Run: npm run fetch-regime-data');
  }

  const results = {};
  for (const ticker of ['SPY', 'QQQ']) {
    const bars = data[ticker.toLowerCase()];
    const r = await trainOne(bars, options);
    results[ticker] = { ...r, bars };
  }

  if (!fs.existsSync(REGIME_DIR)) fs.mkdirSync(REGIME_DIR, { recursive: true });

  for (const ticker of ['SPY', 'QQQ']) {
    const r = results[ticker];
    const modelPath = path.join(REGIME_DIR, `model_${ticker.toLowerCase()}.json`);
    const currentPath = path.join(REGIME_DIR, `current_${ticker.toLowerCase()}.json`);
    const backtestPath = path.join(REGIME_DIR, `backtest_${ticker.toLowerCase()}.json`);

    fs.writeFileSync(
      modelPath,
      JSON.stringify({
        numStates: NUM_STATES,
        dimensions: DIMENSIONS_SINGLE,
        volWindow: VOL_WINDOW,
        stateToLabel: r.stateToLabel,
        pi: r.pi,
        A: r.A,
        mu: r.mu,
        Sigma: r.Sigma,
        trainedAt: new Date().toISOString(),
      }, null, 2),
      'utf8'
    );

    const prediction = predictRegimeForward(r.A, r.currentState, r.stateToLabel);
    const lastN = 21;
    const recentDates = r.dates.slice(-lastN);
    const recentLabels = r.states.map((s) => r.stateToLabel[s]).slice(-lastN);
    const history = recentDates.map((t, i) => ({
      date: new Date(t).toISOString().slice(0, 10),
      regime: recentLabels[i],
    }));

    fs.writeFileSync(
      currentPath,
      JSON.stringify({
        ticker,
        regime: r.currentRegime,
        regimeIndex: r.currentState,
        updatedAt: new Date().toISOString(),
        history,
        prediction,
      }, null, 2),
      'utf8'
    );

    const backtest = computeBacktestMetrics(r.bars, r.dates, r.states, r.stateToLabel);
    fs.writeFileSync(
      backtestPath,
      JSON.stringify({
        ticker,
        updatedAt: new Date().toISOString(),
        fullHistory: backtest.fullHistory,
        metrics: backtest.metrics,
      }, null, 2),
      'utf8'
    );
  }

  return {
    SPY: { currentRegime: results.SPY.currentRegime, converged: results.SPY.converged },
    QQQ: { currentRegime: results.QQQ.currentRegime, converged: results.QQQ.converged },
  };
}

/**
 * Load current regime and predictions for both SPY and QQQ.
 * @returns {{ spy: object | null, qqq: object | null }}
 */
export function loadCurrentRegime() {
  const out = { spy: null, qqq: null };
  for (const key of ['spy', 'qqq']) {
    const p = path.join(REGIME_DIR, `current_${key}.json`);
    if (fs.existsSync(p)) {
      try {
        out[key] = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {}
    }
  }
  // Backward compat: if old current.json exists and both new files missing, return legacy shape
  const legacyPath = path.join(REGIME_DIR, 'current.json');
  if (!out.spy && !out.qqq && fs.existsSync(legacyPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      out.spy = { ...legacy, ticker: 'SPY', prediction: null };
      out.qqq = { ...legacy, ticker: 'QQQ', prediction: null };
    } catch (_) {}
  }
  return out;
}

/**
 * Load 5-year backtest analysis (full history + metrics) for SPY and QQQ.
 * @returns {{ spy: object | null, qqq: object | null }}
 */
export function loadRegimeBacktest() {
  const out = { spy: null, qqq: null };
  for (const key of ['spy', 'qqq']) {
    const p = path.join(REGIME_DIR, `backtest_${key}.json`);
    if (fs.existsSync(p)) {
      try {
        out[key] = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {}
    }
  }
  return out;
}
