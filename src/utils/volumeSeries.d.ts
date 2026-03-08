export interface VolumeInputBar {
  t: number
  o: number
  c: number
  v: number
}

export interface VolumeDataPoint {
  time: number
  value: number
  color: string
}

export interface VolumeMaPoint {
  time: number
  value: number
}

export function buildVolumeSeries(
  bars: VolumeInputBar[],
  period?: number,
): {
  volumeData: VolumeDataPoint[]
  volumeMaData: VolumeMaPoint[]
}
