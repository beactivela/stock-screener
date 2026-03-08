import { assignIBDRelativeStrengthRatings } from './vcp.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const toFinite = (value) => (Number.isFinite(value) ? Number(value) : null);

/**
 * Build a monotonic calibration curve that maps our RS rating -> IBD RS rating.
 * Each point is { x: ourRating, y: ibdRating }.
 */
export function buildCalibrationCurve(samples) {
  if (!Array.isArray(samples)) return [];
  const points = samples
    .map((row) => ({
      x: toFinite(row?.ourRating),
      y: toFinite(row?.ibdRating),
    }))
    .filter((p) => p.x != null && p.y != null);

  if (points.length === 0) return [];

  points.sort((a, b) => a.x - b.x);

  const grouped = [];
  for (const pt of points) {
    const last = grouped[grouped.length - 1];
    if (last && last.x === pt.x) last.ys.push(pt.y);
    else grouped.push({ x: pt.x, ys: [pt.y] });
  }

  const averaged = grouped.map((g) => ({
    x: g.x,
    y: g.ys.reduce((sum, v) => sum + v, 0) / g.ys.length,
  }));

  let lastY = -Infinity;
  return averaged.map((pt) => {
    const y = Math.max(pt.y, lastY);
    lastY = y;
    return { x: pt.x, y };
  });
}

/**
 * Apply the calibration curve to a single rating with linear interpolation.
 * Returns an integer in the 1-99 range, or null if not calibratable.
 */
export function calibrateRating(value, curve) {
  const v = toFinite(value);
  if (v == null || !Array.isArray(curve) || curve.length === 0) return null;

  const sorted = [...curve].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (v <= first.x) return clamp(Math.round(first.y), 1, 99);
  if (v >= last.x) return clamp(Math.round(last.y), 1, 99);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (v >= a.x && v <= b.x) {
      if (a.x === b.x) return clamp(Math.round(a.y), 1, 99);
      const t = (v - a.x) / (b.x - a.x);
      const y = a.y + t * (b.y - a.y);
      return clamp(Math.round(y), 1, 99);
    }
  }

  return clamp(Math.round(last.y), 1, 99);
}

/**
 * Convert raw RS values to IBD-style 1-99 ratings using existing logic.
 * Expects each row to have { relativeStrength } set to raw RS.
 */
export function assignRatingsFromRaw(rows) {
  return assignIBDRelativeStrengthRatings(rows);
}

