/**
 * CLI args for scripts/tradingagents/run.py (after script path).
 * @param {{ ticker: string, asOf: string, provider: string, analysts: string[] }} value
 * @returns {string[]}
 */
export function buildTradingAgentsRunnerArgv(value) {
  return [
    '--ticker',
    value.ticker,
    '--as-of',
    value.asOf,
    '--provider',
    value.provider,
    '--analysts',
    value.analysts.join(','),
  ]
}
