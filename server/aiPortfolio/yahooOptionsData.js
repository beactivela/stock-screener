import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

function pickMid(bid, ask, fallback) {
  const b = Number(bid)
  const a = Number(ask)
  if (Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > 0) return (b + a) / 2
  if (Number.isFinite(a) && a > 0) return a
  if (Number.isFinite(b) && b > 0) return b
  const f = Number(fallback)
  return Number.isFinite(f) ? f : null
}

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase()
}

export async function getStockMarkFromYahoo(ticker) {
  const symbol = normalizeTicker(ticker)
  if (!symbol) return { ok: false, error: 'Missing ticker.' }
  try {
    const q = await yahooFinance.quote(symbol)
    const mark = Number(q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice)
    if (!Number.isFinite(mark) || mark <= 0) return { ok: false, error: `No mark for ${symbol}.` }
    return {
      ok: true,
      mark,
      source: 'yahoo_quote',
      asOf: new Date().toISOString(),
    }
  } catch (error) {
    return { ok: false, error: error?.message || `Failed to fetch quote for ${symbol}.` }
  }
}

export async function getOptionMarkFromYahoo({
  ticker,
  contractSymbol,
}) {
  const symbol = normalizeTicker(ticker)
  if (!symbol || !contractSymbol) return { ok: false, error: 'Missing option lookup fields.' }
  try {
    const chain = await yahooFinance.options(symbol)
    const options = [...(chain?.calls || []), ...(chain?.puts || [])]
    const contract = options.find((o) => String(o?.contractSymbol) === String(contractSymbol))
    if (!contract) return { ok: false, error: `No contract ${contractSymbol} for ${symbol}.` }

    const mark = pickMid(contract.bid, contract.ask, contract.lastPrice)
    if (!Number.isFinite(mark) || mark <= 0) {
      return { ok: false, error: `No valid option mark for ${contractSymbol}.` }
    }
    return {
      ok: true,
      mark,
      source: 'yahoo_option_chain',
      asOf: new Date().toISOString(),
      hasGreeks: Boolean(
        contract.delta != null ||
          contract.gamma != null ||
          contract.theta != null ||
          contract.vega != null ||
          contract.impliedVolatility != null,
      ),
      greeks: {
        delta: contract.delta ?? null,
        gamma: contract.gamma ?? null,
        theta: contract.theta ?? null,
        vega: contract.vega ?? null,
        impliedVolatility: contract.impliedVolatility ?? null,
      },
    }
  } catch (error) {
    return { ok: false, error: error?.message || `Failed to fetch options chain for ${symbol}.` }
  }
}

