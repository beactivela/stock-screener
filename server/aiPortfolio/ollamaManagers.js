import { generateLlmReply } from '../llm/index.js'
import { AI_PORTFOLIO_DEFAULT_MODEL_SLUGS } from './defaultModels.js'
import { AI_PORTFOLIO_MANAGER_IDS, AI_PORTFOLIO_MANAGER_LABELS } from './types.js'

const DEFAULT_MODELS = AI_PORTFOLIO_DEFAULT_MODEL_SLUGS

const MODEL_ENV = {
  claude: 'AI_PORTFOLIO_MODEL_CLAUDE',
  gpt: 'AI_PORTFOLIO_MODEL_GPT',
  gemini: 'AI_PORTFOLIO_MODEL_GEMINI',
  deepseek: 'AI_PORTFOLIO_MODEL_DEEPSEEK',
}

function parseJsonObject(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export function getManagerModelMap() {
  /** @type {Record<string, string>} */
  const map = {}
  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    map[managerId] = String(process.env[MODEL_ENV[managerId]] || DEFAULT_MODELS[managerId]).trim()
  }
  return map
}

/** AI Portfolio daily suggestions: OpenRouter by default (`OPENROUTER_API_KEY`). Override with AI_PORTFOLIO_LLM_PROVIDER. */
export function resolveAiPortfolioLlmProvider() {
  const raw = String(process.env.AI_PORTFOLIO_LLM_PROVIDER || 'openrouter').trim().toLowerCase()
  if (raw === 'openrouter' || raw === 'ollama' || raw === 'anthropic' || raw === 'openai') return raw
  return 'openrouter'
}

/** Normalizes model JSON into an executable suggestion (exported for unit tests). */
export function sanitizeAiPortfolioSuggestion(obj) {
  if (!obj || typeof obj !== 'object') return { action: 'no_trade', reason: 'invalid_payload' }
  const action = String(obj.action || '').toLowerCase()
  if (action === 'hold') {
    return { action: 'no_trade', reason: String(obj.reason || 'model_hold'), _hold: true }
  }
  if (action === 'exit' || action === 'close') {
    const exitPositionId = obj.exitPositionId != null ? String(obj.exitPositionId).trim() : ''
    const exitTicker = String(obj.exitTicker || '').trim().toUpperCase()
    if (!exitPositionId && !exitTicker) {
      return { action: 'no_trade', reason: 'exit_missing_target' }
    }
    return {
      action: 'exit',
      exitPositionId: exitPositionId || undefined,
      exitTicker: exitTicker || undefined,
      exitContractSymbol: obj.exitContractSymbol != null ? String(obj.exitContractSymbol).trim() : undefined,
      reason: String(obj.reason || 'model_exit'),
    }
  }
  if (action !== 'enter') return { action: 'no_trade', reason: String(obj.reason || 'model_no_trade') }
  const ticker = String(obj.ticker || '').trim().toUpperCase()
  if (!ticker) return { action: 'no_trade', reason: 'missing_ticker' }
  return {
    action: 'enter',
    instrumentType: String(obj.instrumentType || 'stock').toLowerCase(),
    strategy: String(obj.strategy || 'stock').toLowerCase(),
    ticker,
    stopLossPct: Number(obj.stopLossPct) || 0.08,
    quantity: Number(obj.quantity) > 0 ? Number(obj.quantity) : undefined,
    contractSymbol: obj.contractSymbol ? String(obj.contractSymbol) : undefined,
    premiumUsd: obj.premiumUsd != null ? Number(obj.premiumUsd) : undefined,
    strike: obj.strike != null ? Number(obj.strike) : undefined,
  }
}

function actionIntentFromParsed(actionRaw, suggestion) {
  const a = String(actionRaw || '').toLowerCase()
  if (a === 'exit' || a === 'close') {
    if (suggestion.action === 'exit') return 'exit'
    return 'exit_invalid'
  }
  if (a === 'enter' && suggestion.action === 'enter') return 'enter'
  if (a === 'hold' || suggestion._hold) return 'hold'
  if (a === 'enter' && suggestion.action !== 'enter') return 'pass'
  return 'pass'
}

export async function suggestManagerBestEntry({
  managerId,
  asOfDate,
  managerState,
  provider = resolveAiPortfolioLlmProvider(),
  modelMap = getManagerModelMap(),
}) {
  const model = modelMap[managerId]
  if (!model) return { action: 'no_trade', reason: `missing_model_${managerId}` }

  const positionsDigest = Array.isArray(managerState?.positions)
    ? managerState.positions.map((p) => ({
        id: p.id,
        ticker: p.ticker,
        instrumentType: p.instrumentType,
        strategy: p.strategy,
        qty: p.quantity,
        contractSymbol: p.contractSymbol || undefined,
        exposureUsd: p.exposureUsd,
        unrealizedPnlUsd: p.unrealizedPnlUsd,
        entryPriceUsd: p.entryPriceUsd,
      }))
    : []

  const prompt = [
    'You manage a live paper-trading book for ONE daily decision.',
    '',
    'STEP 1 — READ THE CURRENT PORTFOLIO FIRST (mandatory):',
    '- Use `openPositions` in the snapshot: each line is capital at risk (exposure, unrealized PnL, strategy).',
    '- Infer sector / industry / theme concentration from TICKERS (e.g. mega-cap tech, semis, financials, energy).',
    '- Name overlapping themes: if two+ positions load the same sector or highly correlated theme, treat that as concentrated risk.',
    '',
    'STEP 2 — DECIDE THE DAY’S ACTION:',
    '- Prefer `exit` (or `close`) to reduce risk, take profit, cut a loser, or de-duplicate exposure when conviction fades.',
    '- Prefer `hold` or `no_trade` when the book is balanced or you have no incremental edge.',
    '- Use `enter` ONLY after the review above, and only for ONE new line item.',
    '- Do NOT open a new position that mostly duplicates an existing sector/theme unless you explicitly justify high conviction in `portfolioReview` (e.g. different catalyst, hedge, or deliberate overweight). Otherwise diversify or exit first.',
    '- When `action` is `enter`, you MUST include `entryThesis` and `entryConviction` (see schema): the UI logs these as the rationale for the new risk.',
    '',
    'Rules (still apply):',
    '- US stocks/options only; long-biased book',
    '- Max 10% concentration per name',
    '- Max 2% portfolio risk per new trade',
    '- Keep at least 20% cash and max 80% deployed',
    '',
    'Return STRICT JSON only (no markdown, no prose outside the object):',
    '{',
    '  "portfolioReview": "2-6 sentences: current risks, sector/theme overlap, whether you are adding, trimming, or standing pat",',
    '  "thesis": "1-4 sentences: macro / view for today",',
    '  "positionStance": "per open position: hold vs trim vs exit intent (narrative; execution uses action below)",',
    '  "action": "enter" | "exit" | "no_trade" | "hold",',
    '  - "hold": keep all positions, no new trade, no exit executed by the system;',
    '  - "no_trade": no new entry and no full exit (you may still describe trims in positionStance for logging only);',
    '  - "exit": close ONE existing line — set exit fields below (full close of that line);',
    '  - "enter": open ONE new stock or option — fill instrument fields AND entry rationale fields below.',
    '  "entryThesis": "when action is enter — required: 2-5 sentences on why THIS name/instrument and setup now (not generic macro only)",',
    '  "entryConviction": "when action is enter — required: one of high | medium | low, then a short clause (e.g. high — asymmetric skew into earnings)",',
    '  "exitPositionId": "optional: id from openPositions for an unambiguous exit",',
    '  "exitTicker": "SYMBOL — required for exit if exitPositionId omitted",',
    '  "exitContractSymbol": "required when exiting an option if multiple open on the same underlying",',
    '  "instrumentType": "stock" | "option",',
    '  "strategy": "stock" | "long_call" | "leap_call" | "cash_secured_put" | "bull_put_spread",',
    '  "ticker": "AAPL",',
    '  "stopLossPct": 0.08,',
    '  "quantity": null,',
    '  "reason": "short label for logs"',
    '}',
    '',
    `Manager persona: ${AI_PORTFOLIO_MANAGER_LABELS[managerId] || managerId}`,
    `Session date: ${asOfDate}`,
    `Portfolio snapshot: ${JSON.stringify({
      equityUsd: managerState?.equityUsd,
      cashUsd: managerState?.cashUsd,
      availableCashUsd: managerState?.availableCashUsd,
      deployedUsd: managerState?.deployedUsd,
      openPositions: positionsDigest,
    })}`,
  ].join('\n')

  const wantUsage = String(provider || '').toLowerCase() === 'openrouter'

  try {
    const raw = await generateLlmReply({
      provider,
      model,
      system:
        'You are a disciplined portfolio manager. Always reason from the current open book before sizing new risk. Be concise. Output JSON only.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 960,
      temperature: 0.25,
      reasoningFallback: false,
      returnFinishReason: wantUsage,
      returnOpenRouterUsage: wantUsage,
    })
    const rawText =
      typeof raw === 'string' ? raw : (raw && typeof raw.text === 'string' ? raw.text : JSON.stringify(raw ?? ''))
    const openRouterUsage =
      wantUsage && raw && typeof raw === 'object' && raw.openRouterUsage != null ? raw.openRouterUsage : null
    const parsed = parseJsonObject(rawText)
    const suggestion = sanitizeAiPortfolioSuggestion(parsed)
    const thesis = String(parsed?.thesis || parsed?.reason || '').trim() || '—'
    const portfolioReview = String(parsed?.portfolioReview || '').trim()
    const positionStance = String(parsed?.positionStance || '').trim()
    const entryThesis = String(parsed?.entryThesis || '').trim()
    const entryConviction = String(parsed?.entryConviction || '').trim()
    const actionIntent = actionIntentFromParsed(parsed?.action, suggestion)

    return {
      suggestion,
      llm: {
        rawText: rawText.slice(0, 12000),
        thesis,
        portfolioReview,
        positionStance,
        entryThesis,
        entryConviction,
        actionIntent,
        model,
        parseOk: Boolean(parsed && typeof parsed === 'object'),
        costUsd: openRouterUsage?.costUsd ?? null,
      },
      usage:
        wantUsage && openRouterUsage
          ? {
              provider: 'openrouter',
              costUsd: openRouterUsage.costUsd,
              promptTokens: openRouterUsage.promptTokens,
              completionTokens: openRouterUsage.completionTokens,
              totalTokens: openRouterUsage.totalTokens,
            }
          : null,
    }
  } catch (err) {
    return {
      suggestion: { action: 'no_trade', reason: 'model_error' },
      llm: {
        rawText: '',
        thesis: '',
        portfolioReview: '',
        positionStance: '',
        entryThesis: '',
        entryConviction: '',
        actionIntent: 'error',
        model,
        parseOk: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        costUsd: null,
      },
      usage: null,
    }
  }
}

