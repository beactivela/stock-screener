/**
 * Canonical OpenRouter slugs for AI Portfolio managers (single source of truth).
 * Override at runtime with AI_PORTFOLIO_MODEL_* env vars.
 */
export const AI_PORTFOLIO_DEFAULT_MODEL_SLUGS = {
  claude: 'anthropic/claude-sonnet-4.6',
  gpt: 'openai/gpt-5.4',
  gemini: 'google/gemini-2.0-flash-001',
  deepseek: 'deepseek/deepseek-v3.2',
}
