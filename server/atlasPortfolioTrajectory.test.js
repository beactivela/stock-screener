import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  downsampleTrajectoryForSparkline,
  parsePortfolioTrajectoryCsv,
  SPARKLINE_MAX_POINTS,
} from './atlasPortfolioTrajectory.js'

describe('atlasPortfolioTrajectory', () => {
  it('parsePortfolioTrajectoryCsv maps date and portfolio_value', () => {
    const csv = `day,date,portfolio_value,daily_return_pct,cumulative_return_pct
1,2024-09-02,660545.56,0,-33.9454
2,2024-09-03,659982.3,-0.0853,-34.0018
`
    const rows = parsePortfolioTrajectoryCsv(csv)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].date, '2024-09-02')
    assert.equal(rows[0].portfolio_value, 660545.56)
    assert.equal(rows[1].portfolio_value, 659982.3)
  })

  it('downsampleTrajectoryForSparkline preserves endpoints when downsampling', () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      date: `2024-09-${String((i % 28) + 1).padStart(2, '0')}`,
      portfolio_value: 1000000 + i,
    }))
    const pts = downsampleTrajectoryForSparkline(rows, SPARKLINE_MAX_POINTS)
    assert.equal(pts.length, SPARKLINE_MAX_POINTS)
    assert.equal(pts[0].value, rows[0].portfolio_value)
    assert.equal(pts[pts.length - 1].value, rows[rows.length - 1].portfolio_value)
  })
})
