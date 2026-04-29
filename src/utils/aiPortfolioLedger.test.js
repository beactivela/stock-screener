import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  filterStaleOpenLedgerRows,
  netSymbolPnlUsd,
  sumRealizedUsdClosedForSymbol,
} from './aiPortfolioLedger.js'

describe('aiPortfolioLedger', () => {
  it('filterStaleOpenLedgerRows removes open row when closed exists for same positionId', () => {
    const rows = [
      { positionId: 'p1', ticker: 'XLU', exitAt: null, status: 'filled' },
      { positionId: 'p1', ticker: 'XLU', exitAt: '2026-04-15', status: 'closed', realizedPnlUsd: -88.2 },
    ]
    const out = filterStaleOpenLedgerRows(rows)
    assert.equal(out.length, 1)
    assert.equal(out[0].status, 'closed')
  })

  it('sumRealizedUsdClosedForSymbol ignores open rows', () => {
    const rows = [
      { ticker: 'MSFT', exitAt: null, realizedPnlUsd: 0 },
      { ticker: 'MSFT', exitAt: '2026-01-01', realizedPnlUsd: 10 },
    ]
    assert.equal(sumRealizedUsdClosedForSymbol(rows, 'MSFT'), 10)
  })

  it('netSymbolPnlUsd combines unrealized with closed-symbol realized', () => {
    const rows = [{ ticker: 'XLU', exitAt: '2026-04-15', realizedPnlUsd: -88.2 }]
    assert.ok(Math.abs(netSymbolPnlUsd(100, rows, 'XLU') - 11.8) < 1e-6)
  })
})
