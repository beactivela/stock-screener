/**
 * Conversation schemas + validators (lightweight, no external deps)
 *
 * Purpose: keep LLM outputs machine-checkable and consistent.
 * These are "strict enough" to prevent rambling, while flexible on optional fields.
 */

const ACTIONS = ['TAKE', 'PASS', 'WATCH'];
const DIRECTIONS = ['LONG'];
const TIMEFRAMES = ['swing', 'position', 'day', 'multi-day'];

function isPlainObject(val) {
  return !!val && typeof val === 'object' && !Array.isArray(val);
}

function isNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

function isString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function validateArray(val, predicate) {
  if (!Array.isArray(val)) return false;
  return val.every(predicate);
}

function addError(errors, msg) {
  errors.push(msg);
}

function validateTargets(targets, errors, path = 'targets') {
  if (!Array.isArray(targets) || targets.length === 0) {
    addError(errors, `${path} must be a non-empty array`);
    return;
  }
  targets.forEach((t, i) => {
    if (!isPlainObject(t)) addError(errors, `${path}[${i}] must be an object`);
    if (!isNumber(t.price)) addError(errors, `${path}[${i}].price must be a number`);
    if (!isString(t.rationale)) addError(errors, `${path}[${i}].rationale must be a string`);
  });
}

export function validateTradeCard(card) {
  const errors = [];
  if (!isPlainObject(card)) {
    addError(errors, 'TradeCard must be an object');
    return { ok: false, errors };
  }

  if (!isString(card.id)) addError(errors, 'TradeCard.id must be a string');
  if (!isString(card.agentType)) addError(errors, 'TradeCard.agentType must be a string');
  if (!isString(card.ticker)) addError(errors, 'TradeCard.ticker must be a string');
  if (!DIRECTIONS.includes(card.direction)) addError(errors, `TradeCard.direction must be one of ${DIRECTIONS.join(', ')}`);
  if (!TIMEFRAMES.includes(card.timeframe)) addError(errors, `TradeCard.timeframe must be one of ${TIMEFRAMES.join(', ')}`);

  if (!isPlainObject(card.entry)) addError(errors, 'TradeCard.entry must be an object');
  if (card.entry) {
    if (!isString(card.entry.trigger)) addError(errors, 'TradeCard.entry.trigger must be a string');
    if (!isNumber(card.entry.price)) addError(errors, 'TradeCard.entry.price must be a number');
    if (!isString(card.entry.rationale)) addError(errors, 'TradeCard.entry.rationale must be a string');
  }

  if (!isPlainObject(card.invalidation)) addError(errors, 'TradeCard.invalidation must be an object');
  if (card.invalidation) {
    if (!isNumber(card.invalidation.price)) addError(errors, 'TradeCard.invalidation.price must be a number');
    if (!isString(card.invalidation.rule)) addError(errors, 'TradeCard.invalidation.rule must be a string');
  }

  validateTargets(card.targets, errors);

  if (!isNumber(card.confidence)) addError(errors, 'TradeCard.confidence must be a number');
  if (isNumber(card.confidence) && (card.confidence < 0 || card.confidence > 100)) {
    addError(errors, 'TradeCard.confidence must be between 0 and 100');
  }

  if (!validateArray(card.failureModes, isString)) addError(errors, 'TradeCard.failureModes must be an array of strings');

  if (!isPlainObject(card.evidence)) addError(errors, 'TradeCard.evidence must be an object');
  if (card.evidence) {
    if (!isString(card.evidence.signalType)) addError(errors, 'TradeCard.evidence.signalType must be a string');
    if (card.evidence.opus45Confidence != null && !isNumber(card.evidence.opus45Confidence)) {
      addError(errors, 'TradeCard.evidence.opus45Confidence must be a number');
    }
    if (card.evidence.riskRewardRatio != null && !isNumber(card.evidence.riskRewardRatio)) {
      addError(errors, 'TradeCard.evidence.riskRewardRatio must be a number');
    }
    if (card.evidence.regime != null && !isString(card.evidence.regime)) {
      addError(errors, 'TradeCard.evidence.regime must be a string');
    }
  }

  if (card.notes != null && !isString(card.notes)) addError(errors, 'TradeCard.notes must be a string');

  return { ok: errors.length === 0, errors };
}

export function validateChallenge(challenge) {
  const errors = [];
  if (!isPlainObject(challenge)) {
    addError(errors, 'Challenge must be an object');
    return { ok: false, errors };
  }

  if (!isString(challenge.id)) addError(errors, 'Challenge.id must be a string');
  if (!isString(challenge.fromAgent)) addError(errors, 'Challenge.fromAgent must be a string');
  if (!isString(challenge.toAgent)) addError(errors, 'Challenge.toAgent must be a string');
  if (!isString(challenge.ticker)) addError(errors, 'Challenge.ticker must be a string');
  if (!isString(challenge.assumption)) addError(errors, 'Challenge.assumption must be a string');
  if (!isString(challenge.risk)) addError(errors, 'Challenge.risk must be a string');
  if (!isString(challenge.testableRule)) addError(errors, 'Challenge.testableRule must be a string');
  if (!isNumber(challenge.confidenceImpact)) addError(errors, 'Challenge.confidenceImpact must be a number');

  return { ok: errors.length === 0, errors };
}

export function validateDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) {
    addError(errors, 'Decision must be an object');
    return { ok: false, errors };
  }

  if (!isString(decision.id)) addError(errors, 'Decision.id must be a string');
  if (!isString(decision.ticker)) addError(errors, 'Decision.ticker must be a string');
  if (!ACTIONS.includes(decision.action)) addError(errors, `Decision.action must be one of ${ACTIONS.join(', ')}`);
  if (!isNumber(decision.sizingPct)) addError(errors, 'Decision.sizingPct must be a number');
  if (isNumber(decision.sizingPct) && (decision.sizingPct < 0 || decision.sizingPct > 100)) {
    addError(errors, 'Decision.sizingPct must be between 0 and 100');
  }
  if (!isString(decision.entryPlan)) addError(errors, 'Decision.entryPlan must be a string');

  if (!isPlainObject(decision.stopLoss)) addError(errors, 'Decision.stopLoss must be an object');
  if (decision.stopLoss) {
    if (!isNumber(decision.stopLoss.price)) addError(errors, 'Decision.stopLoss.price must be a number');
    if (!isString(decision.stopLoss.rule)) addError(errors, 'Decision.stopLoss.rule must be a string');
  }

  validateTargets(decision.targets, errors, 'Decision.targets');

  if (!validateArray(decision.killCriteria, isString)) addError(errors, 'Decision.killCriteria must be an array of strings');
  if (!isString(decision.rationale)) addError(errors, 'Decision.rationale must be a string');
  if (!validateArray(decision.dissentingAgents, isString)) addError(errors, 'Decision.dissentingAgents must be an array of strings');

  return { ok: errors.length === 0, errors };
}

export const SCHEMAS = {
  TradeCard: 'TradeCard',
  Challenge: 'Challenge',
  Decision: 'Decision',
};
