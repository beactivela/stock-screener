const UP_VOLUME_COLOR = '#22c55e'
const DOWN_VOLUME_COLOR = '#ef4444'

function sma(values, period) {
  const out = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    out.push(sum / period)
  }
  return out
}

/**
 * Build volume histogram data + volume MA series for lightweight-charts.
 * @param {Array<{t:number,o:number,c:number,v:number}>} bars
 * @param {number} period
 */
export function buildVolumeSeries(bars, period = 20) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return { volumeData: [], volumeMaData: [] }
  }

  const volumes = bars.map((b) => Number(b?.v ?? 0))
  const volSma = sma(volumes, period)
  const toTime = (t) => Math.floor(t / 1000)

  const volumeData = bars.map((b, i) => ({
    time: toTime(b.t),
    value: volumes[i],
    color: b.c >= b.o ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
  }))

  const volumeMaData = bars
    .map((b, i) => ({ time: toTime(b.t), value: volSma[i] }))
    .filter((d) => d.value != null)

  return { volumeData, volumeMaData }
}
