/**
 * Extract all tickers from Industry page data (TradingView Scanner API) into data/tickers.txt.
 * Sorts alphabetically. Run: node scripts/extract-industry-tickers.js
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TRADINGVIEW_SCANNER_URL = 'https://scanner.tradingview.com/america/scan'
const TV_SCAN_PAGE_SIZE = 250
const TV_SCAN_MAX_PAGES = 40 // 250*40 = 10k symbols max
const MIN_MARKET_CAP = 5e9 // $5B minimum

/** Exclude REITs, trusts, mutual funds, closed-end funds, Investment Trusts/Mutual Funds (from sector/industry). */
function isExcluded(sector, industry) {
  const s = (sector || '').toLowerCase()
  const i = (industry || '').toLowerCase()
  if (s === 'real estate') return true // REITs
  if (i.includes('reit')) return true
  if (i.includes('trust')) return true
  if (i.includes('mutual fund')) return true
  if (i.includes('closed-end fund')) return true
  // TradingView: https://www.tradingview.com/markets/stocks-usa/sectorandindustry-industry/investment-trusts-mutual-funds/
  if (i.includes('investment trust')) return true
  return false
}

async function fetchIndustryData() {
  const columns = [
    'name', 'sector', 'industry', 'close', 'market_cap_basic',
    'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.YTD', 'Perf.Y',
  ]
  const allRows = []

  for (let page = 0; page < TV_SCAN_MAX_PAGES; page++) {
    const start = page * TV_SCAN_PAGE_SIZE
    const body = {
      filter: [
        { left: 'type', operation: 'equal', right: 'stock' },
        { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
      ],
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      columns,
      range: [start, start + TV_SCAN_PAGE_SIZE],
    }

    const res = await fetch(TRADINGVIEW_SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) throw new Error(`TradingView scanner HTTP ${res.status}`)

    const scanJson = await res.json()
    const data = scanJson.data || []

    for (const row of data) {
      const symbol = row.s
      const values = row.d
      if (!values || values.length < 5) continue
      const sector = String(values[1] ?? '').trim()
      const industry = String(values[2] ?? '').trim()
      const marketCap = values[4] != null ? Number(values[4]) : null
      if (!industry) continue
      if (marketCap == null || marketCap < MIN_MARKET_CAP) continue

      // Exclude REITs, trusts, mutual funds, closed-end funds
      if (isExcluded(sector, industry)) continue

      const ticker = symbol ? symbol.split(':').pop() : null
      if (ticker) allRows.push({ ticker, industry })
    }

    if (data.length < TV_SCAN_PAGE_SIZE) break
  }

  return allRows
}

async function main() {
  console.log('Fetching Industry data from TradingView...')
  const rows = await fetchIndustryData()

  const tickers = [...new Set(rows.map((r) => r.ticker).filter(Boolean))]
  tickers.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const outPath = path.join(__dirname, '..', 'data', 'tickers.txt')
  fs.writeFileSync(outPath, tickers.join('\n') + (tickers.length ? '\n' : ''), 'utf8')

  console.log(`Wrote ${tickers.length} tickers to ${outPath} (sorted A–Z)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
