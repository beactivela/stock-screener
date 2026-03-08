/**
 * Conversation Orchestrator
 *
 * Runs a structured multi-round dialogue:
 * - Round 1: Independent TradeCards from specialists (isolated)
 * - Round 2: Cross-examination Challenges
 * - Round 3: Marcus Decision (TAKE / PASS / WATCH)
 *
 * This is advisory-only and returns a structured transcript + decision.
 */

import { generateLlmReply, resolveDialogueConfig } from '../llm/index.js';
import {
  validateTradeCard,
  validateChallenge,
  validateDecision,
} from './conversationSchemas.js';

const DEFAULT_SPECIALISTS = [
  { agentType: 'momentum_scout', name: 'Momentum Scout' },
  { agentType: 'base_hunter', name: 'Base Hunter' },
  { agentType: 'breakout_tracker', name: 'Breakout Tracker' },
  { agentType: 'turtle_trader', name: 'Turtle Trader' },
];

const DEFAULT_CHALLENGERS = [
  { agentType: 'base_hunter', name: 'Base Hunter' },
  { agentType: 'momentum_scout', name: 'Momentum Scout' },
];

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw && raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildBrief(signal, regime, constraints = {}) {
  const metrics = signal.metrics || {};
  return {
    ticker: signal.ticker,
    signalType: signal.signalType,
    opus45Confidence: signal.opus45Confidence,
    riskRewardRatio: signal.riskRewardRatio,
    entryPrice: signal.entryPrice || null,
    stopLossPrice: signal.stopLossPrice || null,
    regime,
    context: {
      relativeStrength: metrics.relativeStrength ?? null,
      patternConfidence: metrics.patternConfidence ?? null,
      contractions: metrics.contractions ?? null,
      pctFromHigh: metrics.stats52w?.pctFromHigh ?? null,
    },
    constraints: {
      riskPerTradePct: constraints.riskPerTradePct ?? 1.5,
      maxPositionPct: constraints.maxPositionPct ?? 10,
      holdingPeriod: constraints.holdingPeriod ?? 'multi-day to multi-week',
    },
  };
}

function buildRound1System(agentName) {
  return [
    `You are ${agentName}, a specialist Signal Agent.`,
    `Output ONLY valid JSON matching this TradeCard schema:`,
    `{
  "id": "string",
  "agentType": "string",
  "ticker": "string",
  "direction": "LONG",
  "timeframe": "swing|position|day|multi-day",
  "entry": {"trigger": "string", "price": number, "rationale": "string"},
  "invalidation": {"price": number, "rule": "string"},
  "targets": [{"price": number, "rationale": "string"}],
  "confidence": number,
  "failureModes": ["string"],
  "evidence": {"signalType": "string", "opus45Confidence": number, "riskRewardRatio": number, "regime": "string"},
  "notes": "string"
}`,
    `No extra text. No markdown.`,
  ].join('\n');
}

function buildRound2System(agentName) {
  return [
    `You are ${agentName}, acting as a Red Team reviewer.`,
    `Output ONLY valid JSON matching this Challenge schema:`,
    `{
  "id": "string",
  "fromAgent": "string",
  "toAgent": "string",
  "ticker": "string",
  "assumption": "string",
  "risk": "string",
  "testableRule": "string",
  "confidenceImpact": number
}`,
    `No extra text. No markdown.`,
  ].join('\n');
}

function buildRound3System() {
  return [
    `You are Marcus, the CEO Money Manager.`,
    `Decide TAKE / PASS / WATCH using risk discipline.`,
    `Output ONLY valid JSON matching this Decision schema:`,
    `{
  "id": "string",
  "ticker": "string",
  "action": "TAKE|PASS|WATCH",
  "sizingPct": number,
  "entryPlan": "string",
  "stopLoss": {"price": number, "rule": "string"},
  "targets": [{"price": number, "rationale": "string"}],
  "killCriteria": ["string"],
  "rationale": "string",
  "dissentingAgents": ["string"]
}`,
    `No extra text. No markdown.`,
  ].join('\n');
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function resolveLlmTimeoutMs(overrideMs) {
  const envMs = Number(process.env.AGENT_DIALOGUE_TIMEOUT_MS);
  const fallback = Number.isFinite(envMs) && envMs > 0 ? envMs : 30000;
  const override = Number(overrideMs);
  return Number.isFinite(override) && override > 0 ? override : fallback;
}

async function defaultLlmGenerate({ provider, model, system, messages, timeoutMs }) {
  const { provider: resolvedProvider } = resolveDialogueConfig({ provider });
  const run = generateLlmReply({
    provider: resolvedProvider,
    model,
    system,
    messages,
    maxTokens: 800,
    temperature: 0.2,
  });
  const ms = resolveLlmTimeoutMs(timeoutMs);
  return withTimeout(run, ms, 'LLM request');
}

export async function runConversationForSignal(signal, options = {}) {
  const {
    regime = 'UNCERTAIN',
    constraints = {},
    llmGenerate = defaultLlmGenerate,
    specialists = DEFAULT_SPECIALISTS,
    challengers = DEFAULT_CHALLENGERS,
    llmConfig = resolveDialogueConfig(options.llmConfig || {}),
    timeoutMs = null,
  } = options;

  const brief = buildBrief(signal, regime, constraints);
  const transcript = { brief, rounds: [] };

  // ── Round 1: Independent TradeCards ──
  const tradeCards = [];
  for (const agent of specialists) {
    const system = buildRound1System(agent.name);
    const userMsg = `Signal brief:\n${JSON.stringify(brief, null, 2)}`;
    const raw = await llmGenerate({
      purpose: 'round1',
      agent,
      provider: llmConfig.provider,
      model: llmConfig.modelStrong,
      system,
      messages: [{ role: 'user', content: userMsg }],
      timeoutMs,
    });
    const parsed = safeJsonParse(raw);
    const validation = validateTradeCard(parsed || {});
    if (!validation.ok) {
      tradeCards.push({
        id: `card_${agent.agentType}`,
        agentType: agent.agentType,
        ticker: signal.ticker,
        direction: 'LONG',
        timeframe: 'swing',
        entry: { trigger: 'N/A', price: signal.entryPrice || 0, rationale: 'Invalid LLM output' },
        invalidation: { price: signal.stopLossPrice || 0, rule: 'Fallback invalidation' },
        targets: [{ price: signal.entryPrice || 0, rationale: 'Fallback target' }],
        confidence: 0,
        failureModes: ['LLM output invalid'],
        evidence: {
          signalType: signal.signalType || 'UNKNOWN',
          opus45Confidence: signal.opus45Confidence || 0,
          riskRewardRatio: signal.riskRewardRatio || 0,
          regime,
        },
        notes: `Validation failed: ${validation.errors.join('; ')}`,
      });
    } else {
      tradeCards.push(parsed);
    }
  }
  transcript.rounds.push({ name: 'round1', outputs: tradeCards });

  // ── Round 2: Cross-examination ──
  const challenges = [];
  const targetCard = tradeCards[0] || null;
  for (const agent of challengers) {
    if (!targetCard) break;
    const system = buildRound2System(agent.name);
    const userMsg = `TradeCard to challenge:\n${JSON.stringify(targetCard, null, 2)}\n\nSignal brief:\n${JSON.stringify(brief, null, 2)}`;
    const raw = await llmGenerate({
      purpose: 'round2',
      agent,
      provider: llmConfig.provider,
      model: llmConfig.modelStrong,
      system,
      messages: [{ role: 'user', content: userMsg }],
      timeoutMs,
    });
    const parsed = safeJsonParse(raw);
    const validation = validateChallenge(parsed || {});
    if (!validation.ok) {
      challenges.push({
        id: `ch_${agent.agentType}`,
        fromAgent: agent.agentType,
        toAgent: targetCard.agentType,
        ticker: signal.ticker,
        assumption: 'N/A',
        risk: 'LLM output invalid',
        testableRule: 'N/A',
        confidenceImpact: 0,
      });
    } else {
      challenges.push(parsed);
    }
  }
  transcript.rounds.push({ name: 'round2', outputs: challenges });

  // ── Round 3: Marcus Decision ──
  const system = buildRound3System();
  const userMsg = `Signal brief:\n${JSON.stringify(brief, null, 2)}\n\nTradeCards:\n${JSON.stringify(tradeCards, null, 2)}\n\nChallenges:\n${JSON.stringify(challenges, null, 2)}`;
  const raw = await llmGenerate({
    purpose: 'round3',
    agent: { agentType: 'marcus_ceo', name: 'Marcus' },
    provider: llmConfig.provider,
    model: llmConfig.modelFast,
    system,
    messages: [{ role: 'user', content: userMsg }],
    timeoutMs,
  });
  const parsed = safeJsonParse(raw);
  const validation = validateDecision(parsed || {});
  const decision = validation.ok
    ? parsed
    : {
      id: `dec_${signal.ticker}`,
      ticker: signal.ticker,
      action: 'WATCH',
      sizingPct: 0,
      entryPlan: 'Invalid LLM output',
      stopLoss: { price: signal.stopLossPrice || 0, rule: 'Fallback stop' },
      targets: [{ price: signal.entryPrice || 0, rationale: 'Fallback target' }],
      killCriteria: ['LLM output invalid'],
      rationale: `Decision validation failed: ${validation.errors.join('; ')}`,
      dissentingAgents: [],
    };

  transcript.rounds.push({ name: 'round3', output: decision });

  return { decision, transcript };
}
