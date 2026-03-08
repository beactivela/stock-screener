import { generateLlmReply, resolveDialogueConfig } from '../llm/index.js';

const ALLOWED_METRICS = new Set([
  'relativeStrength',
  'ma10Slope14d',
  'pctFromHigh',
  'contractions',
  'patternConfidence',
  'volumeDryUp',
  'breakoutVolumeRatio',
  'turtleBreakout20or55',
  'priceAboveAllMAs',
  'ma200Rising',
  'ma10Above20',
  'unusualVolume3d',
  'unusualVolume5d',
  'priceHigherThan3dAgo',
]);

const ALLOWED_OPS = new Set(['eq', 'gt', 'gte', 'lt', 'lte']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseComparison(text) {
  const m = text.match(/(>=|≤|<=|≥|>|<)\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const opToken = m[1];
  const value = toNumber(m[2]);
  if (value == null) return null;
  const op =
    opToken === '>=' || opToken === '≥'
      ? 'gte'
      : opToken === '<=' || opToken === '≤'
        ? 'lte'
        : opToken === '>'
          ? 'gt'
          : 'lt';
  return { op, value };
}

function parseCriteriaLine(line) {
  const original = String(line || '').trim();
  if (!original) return { ignored: true };

  const text = original.toLowerCase();

  if (text.includes('signal family')) return { ignored: true };

  if (text.includes('unusual volume')) {
    const dayMatch = text.match(/last\s+(\d+)\s+days?/i);
    const days = dayMatch ? Number(dayMatch[1]) : null;
    if (days === 3) return { criterion: { metric: 'unusualVolume3d', op: 'eq', value: true } };
    if (days === 5) return { criterion: { metric: 'unusualVolume5d', op: 'eq', value: true } };
    return { unsupported: original };
  }

  if (text.includes('latest price') && text.includes('days ago')) {
    const daysMatch = text.match(/(\d+)\s+days?\s+ago/i);
    const days = daysMatch ? Number(daysMatch[1]) : null;
    if (days === 3 && (text.includes('higher') || text.includes('greater'))) {
      return { criterion: { metric: 'priceHigherThan3dAgo', op: 'eq', value: true } };
    }
    return { unsupported: original };
  }

  if (text.includes('relative strength')) {
    const cmp = parseComparison(text);
    return cmp
      ? { criterion: { metric: 'relativeStrength', op: cmp.op, value: cmp.value } }
      : { unsupported: original };
  }

  if (text.includes('10 ma slope') || text.includes('10ma slope')) {
    const cmp = parseComparison(text);
    return cmp
      ? { criterion: { metric: 'ma10Slope14d', op: cmp.op, value: cmp.value } }
      : { unsupported: original };
  }

  if (text.includes('within') && text.includes('52-week high')) {
    const m = text.match(/within\s+(\d+(?:\.\d+)?)\s*%/i);
    const value = m ? toNumber(m[1]) : null;
    return value != null
      ? { criterion: { metric: 'pctFromHigh', op: 'lte', value } }
      : { unsupported: original };
  }

  if (text.includes('contractions')) {
    const cmp = parseComparison(text);
    return cmp
      ? { criterion: { metric: 'contractions', op: cmp.op, value: cmp.value } }
      : { unsupported: original };
  }

  if (text.includes('pattern confidence')) {
    const cmp = parseComparison(text);
    return cmp
      ? { criterion: { metric: 'patternConfidence', op: cmp.op, value: cmp.value } }
      : { unsupported: original };
  }

  if (text.includes('volume dry-up') || text.includes('volume dry up')) {
    return { criterion: { metric: 'volumeDryUp', op: 'eq', value: true } };
  }

  if (text.includes('breakout volume ratio')) {
    const cmp = parseComparison(text);
    return cmp
      ? { criterion: { metric: 'breakoutVolumeRatio', op: cmp.op, value: cmp.value } }
      : { unsupported: original };
  }

  if (text.includes('donchian') && text.includes('breakout')) {
    return { criterion: { metric: 'turtleBreakout20or55', op: 'eq', value: true } };
  }

  if (text.includes('price above all ma')) {
    return { criterion: { metric: 'priceAboveAllMAs', op: 'eq', value: true } };
  }

  if (text.includes('200 ma rising')) {
    return { criterion: { metric: 'ma200Rising', op: 'eq', value: true } };
  }

  if (text.includes('10 ma crosses above 20 ma') || text.includes('10 ma > 20 ma') || text.includes('10 ma above 20 ma')) {
    return { criterion: { metric: 'ma10Above20', op: 'eq', value: true } };
  }

  return { unsupported: original };
}

export function translateCriteriaLines(agentId, criteriaLines = []) {
  const compiledCriteria = [];
  const unsupported = [];

  for (const line of criteriaLines) {
    const parsed = parseCriteriaLine(line);
    if (parsed.criterion) compiledCriteria.push(parsed.criterion);
    if (parsed.unsupported) unsupported.push(parsed.unsupported);
  }

  return {
    agentId,
    compiledCriteria,
    unsupported,
    method: 'rules',
  };
}

function normalizeCriteriaShape(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const rawCriteria = Array.isArray(payload.compiledCriteria) ? payload.compiledCriteria : null;
  if (!rawCriteria) return null;
  const compiledCriteria = rawCriteria
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const metric = String(item.metric || '').trim();
      const op = String(item.op || '').trim();
      const value = item.value;
      if (!ALLOWED_METRICS.has(metric) || !ALLOWED_OPS.has(op)) return null;
      if (!['boolean', 'number', 'string'].includes(typeof value)) return null;
      return { metric, op, value };
    })
    .filter(Boolean);
  const unsupported = Array.isArray(payload.unsupported)
    ? payload.unsupported.map((x) => String(x))
    : [];
  return { compiledCriteria, unsupported };
}

async function tryLlmTranslation(agentId, criteriaLines) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return null;

  const cfg = resolveDialogueConfig({});
  const system = [
    'You convert stock scan criteria into executable JSON filters.',
    'Return ONLY valid JSON.',
    'Schema: {"compiledCriteria":[{"metric":"...","op":"eq|gt|gte|lt|lte","value":number|boolean|string}],"unsupported":["..."]}',
    `Allowed metrics: ${Array.from(ALLOWED_METRICS).join(', ')}`,
  ].join('\n');
  const userPrompt = [
    `Agent: ${agentId}`,
    'Criteria lines:',
    ...criteriaLines.map((line, i) => `${i + 1}. ${line}`),
  ].join('\n');

  const reply = await generateLlmReply({
    provider: cfg.provider,
    model: cfg.modelFast || cfg.modelStrong,
    system,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: Math.min(cfg.maxTokens || 800, 700),
    temperature: 0,
  });

  const trimmed = String(reply || '').trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
  return normalizeCriteriaShape(parsed);
}

export async function translateCriteriaToSearchCriteria(agentId, criteriaLines = []) {
  const fallback = translateCriteriaLines(agentId, criteriaLines);
  try {
    const llm = await tryLlmTranslation(agentId, criteriaLines);
    if (!llm) return fallback;
    return {
      agentId,
      compiledCriteria: llm.compiledCriteria.length > 0 ? llm.compiledCriteria : fallback.compiledCriteria,
      unsupported: llm.unsupported.length >= fallback.unsupported.length ? llm.unsupported : fallback.unsupported,
      method: 'llm',
    };
  } catch {
    return fallback;
  }
}
