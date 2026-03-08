export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const pct = Math.max(0, Math.min(100, Number(p)));
  const idx = Math.floor((pct / 100) * (nums.length - 1));
  return nums[idx];
}

export function summarizePercentiles(values, percentiles = [50, 90]) {
  if (!Array.isArray(values) || values.length === 0) {
    const summary = { count: 0, avg: null };
    for (const p of percentiles) summary[`p${p}`] = null;
    return summary;
  }
  const nums = values.filter((v) => Number.isFinite(v));
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const summary = {
    count: nums.length,
    avg: avg == null ? null : Math.round(avg * 1000) / 1000,
  };
  for (const p of percentiles) {
    summary[`p${p}`] = percentile(nums, p);
  }
  return summary;
}
