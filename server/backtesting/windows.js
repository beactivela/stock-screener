/**
 * Date window utilities for backtesting hierarchy.
 * Uses inclusive date ranges (YYYY-MM-DD).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function endOfMonthUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return d;
}

function addMonthsClamped(date, months) {
  const day = date.getUTCDate();
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  const lastDay = endOfMonthUtc(base).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base;
}

/**
 * Split a date range into in-sample and holdout ranges.
 * Holdout is the last X% of the range, inclusive.
 */
export function splitHoldoutRange({ startDate, endDate, holdoutPct = 0.2 }) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');
  if (!Number.isFinite(holdoutPct) || holdoutPct < 0.05 || holdoutPct >= 0.5) {
    throw new Error('holdoutPct must be between 0.05 and 0.5');
  }

  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (end < start) throw new Error('endDate must be after startDate');

  const totalDays = Math.floor((end - start) / MS_PER_DAY) + 1;
  const holdoutDays = Math.max(1, Math.floor(totalDays * holdoutPct));
  const holdoutStart = addDays(end, -(holdoutDays - 1));
  const inSampleEnd = addDays(holdoutStart, -1);

  if (inSampleEnd < start) {
    throw new Error('holdoutPct leaves no in-sample range');
  }

  return {
    inSample: { from: formatDate(start), to: formatDate(inSampleEnd) },
    holdout: { from: formatDate(holdoutStart), to: formatDate(end) },
    meta: { totalDays, holdoutDays, holdoutPct },
  };
}

/**
 * Build rolling walk-forward windows.
 * Each window has: train [from,to], test [from,to], inclusive.
 */
export function buildWalkForwardWindows({
  startDate,
  endDate,
  trainMonths = 12,
  testMonths = 1,
  stepMonths = 1,
}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');
  if (trainMonths <= 0 || testMonths <= 0 || stepMonths <= 0) {
    throw new Error('trainMonths, testMonths, stepMonths must be > 0');
  }

  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (end < start) throw new Error('endDate must be after startDate');

  const windows = [];
  let index = 0;
  let trainStart = start;

  while (true) {
    const trainEndExclusive = addMonthsClamped(trainStart, trainMonths);
    const trainEnd = addDays(trainEndExclusive, -1);
    const testStart = addDays(trainEnd, 1);
    const testEndExclusive = addMonthsClamped(testStart, testMonths);
    const testEnd = addDays(testEndExclusive, -1);

    if (testEnd > end) break;

    windows.push({
      index,
      train: { from: formatDate(trainStart), to: formatDate(trainEnd) },
      test: { from: formatDate(testStart), to: formatDate(testEnd) },
    });

    trainStart = addMonthsClamped(trainStart, stepMonths);
    if (trainStart > end) break;
    index += 1;
  }

  return windows;
}
