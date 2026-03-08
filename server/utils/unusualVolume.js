const DEFAULT_THRESHOLD_RATIO = 1.5;
const DEFAULT_LOOKBACK_DAYS = 3;

export function computeUnusualVolume(bars, volSma20, options = {}) {
  if (!Array.isArray(bars) || bars.length < 4) {
    return {
      unusualVolumeToday: false,
      unusualVolume3d: false,
      unusualVolume5d: false,
      priceHigherThan3dAgo: false,
    };
  }

  const thresholdRatio = options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const lastIdx = bars.length - 1;
  const matches = [];

  for (let offset = 0; offset < lookbackDays && lastIdx - offset > 0; offset++) {
    const idx = lastIdx - offset;
    const bar = bars[idx];
    const volume = bar?.v ?? bar?.volume ?? 0;
    const avgVol20 = Array.isArray(volSma20) ? volSma20[idx] : null;

    const volumeHigher = avgVol20 != null && avgVol20 > 0 && volume >= avgVol20 * thresholdRatio;
    matches.push(volumeHigher);
  }

  const unusualVolumeToday = matches[0] ?? false;
  const unusualVolume3d = matches.some(Boolean);

  const latestClose = bars[lastIdx]?.c ?? null;
  const close3dAgo = bars[lastIdx - 3]?.c ?? null;
  const priceHigherThan3dAgo =
    latestClose != null && close3dAgo != null && latestClose > close3dAgo;

  // Keep unusualVolume5d key as compatibility alias for existing consumers.
  const unusualVolume5d = unusualVolume3d;

  return {
    unusualVolumeToday,
    unusualVolume3d,
    unusualVolume5d,
    priceHigherThan3dAgo,
  };
}
