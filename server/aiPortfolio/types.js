export const AI_PORTFOLIO_MANAGER_IDS = ['claude', 'gpt', 'gemini', 'deepseek']

export const AI_PORTFOLIO_MANAGER_LABELS = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
}

export const AI_PORTFOLIO_STARTING_CAPITAL_USD = 50000
export const AI_PORTFOLIO_MAX_CONCENTRATION_PCT = 10
export const AI_PORTFOLIO_MAX_RISK_PER_TRADE_PCT = 2
export const AI_PORTFOLIO_MAX_DEPLOYED_PCT = 80
export const AI_PORTFOLIO_MIN_CASH_PCT = 20
export const AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT = 5
export const AI_PORTFOLIO_BENCHMARK_TICKER = 'SPY'

export const AI_PORTFOLIO_ALLOWED_OPTION_STRATEGIES = [
  'long_call',
  'leap_call',
  'cash_secured_put',
  'bull_put_spread',
]

export function roundUsd(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

