/**
 * Build a legend/tooltip snapshot for a given chart time.
 * @param {object} params
 * @param {number} params.time
 * @param {Map<number, {o:number,h:number,l:number,c:number,v:number}>} params.barsByTime
 * @param {Map<number, number>} params.ma10ByTime
 * @param {Map<number, number>} params.ma20ByTime
 * @param {Map<number, number>} params.ma50ByTime
 * @param {Map<number, number>} params.volumeMaByTime
 */
export function buildLegendSnapshot({
  time,
  barsByTime,
  ma10ByTime,
  ma20ByTime,
  ma50ByTime,
  volumeMaByTime,
}) {
  const bar = barsByTime.get(time)
  if (!bar) return null

  return {
    time,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v ?? 0,
    ma10: ma10ByTime.get(time) ?? null,
    ma20: ma20ByTime.get(time) ?? null,
    ma50: ma50ByTime.get(time) ?? null,
    volumeMa: volumeMaByTime.get(time) ?? null,
  }
}
