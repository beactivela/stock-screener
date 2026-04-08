/**
 * Display fallbacks for AI Portfolio manager OpenRouter slugs.
 * Keep in sync with `server/aiPortfolio/defaultModels.js` → `AI_PORTFOLIO_DEFAULT_MODEL_SLUGS`.
 */
export const AI_PORTFOLIO_DEFAULT_MODEL_SLUGS_DISPLAY = {
  claude: 'anthropic/claude-sonnet-4.6',
  gpt: 'openai/gpt-5.4',
  gemini: 'google/gemini-2.0-flash-001',
  deepseek: 'deepseek/deepseek-v3.2',
} as const

export type AiPortfolioManagerId = keyof typeof AI_PORTFOLIO_DEFAULT_MODEL_SLUGS_DISPLAY

export function displaySlugForManager(id: string): string | undefined {
  return AI_PORTFOLIO_DEFAULT_MODEL_SLUGS_DISPLAY[id as AiPortfolioManagerId]
}
