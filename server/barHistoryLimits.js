/**
 * IBD-style RS raw calc (vcp.calculateRelativeStrength) needs >252 row indices → 253+ daily bars.
 * Short caches still satisfy VCP (~60 bars) but leave RS / Signal Agent / Lance empty.
 */

export const MIN_DAILY_BARS_FOR_IBD_RS = 253;

/**
 * Only enforce the 253-bar rule when the requested window is long enough to expect
 * ~1y of trading data (scan uses ~420 calendar days). Short windows (charts) may
 * legitimately return fewer bars.
 */
export function longRangeExpectsIbdrs(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${String(to).slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
  const spanDays = (b - a) / (86400000);
  return spanDays >= 280;
}
