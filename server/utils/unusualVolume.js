const DEFAULT_THRESHOLD_RATIO = 1.5;
const DEFAULT_LOOKBACK_DAYS = 5;

export function computeUnusualVolume(bars, volSma20, options = {}) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return { unusualVolumeToday: false, unusualVolume5d: false };
  }

  const thresholdRatio = options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const lastIdx = bars.length - 1;
  const matches = [];

  for (let offset = 0; offset < lookbackDays && lastIdx - offset > 0; offset++) {
    const idx = lastIdx - offset;
    const bar = bars[idx];
    const prev = bars[idx - 1];
    const volume = bar?.v ?? bar?.volume ?? 0;
    const avgVol20 = Array.isArray(volSma20) ? volSma20[idx] : null;
    const close = bar?.c ?? null;
    const prevHigh = prev?.h ?? prev?.c ?? null;

    const volumeHigher = avgVol20 != null && avgVol20 > 0 && volume >= avgVol20 * thresholdRatio;
    const priceHigher = close != null && prevHigh != null && close > prevHigh;

    matches.push(volumeHigher && priceHigher);
  }

  const unusualVolumeToday = matches[0] ?? false;
  const unusualVolume5d = matches.some(Boolean);
  return { unusualVolumeToday, unusualVolume5d };
}
