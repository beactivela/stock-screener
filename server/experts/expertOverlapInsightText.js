/**
 * Post-process LLM output for /api/experts/ai-insights so the UI shows only user-facing prose.
 * Models sometimes echo system instructions; we prefer a tagged format, then strip known rubric noise.
 */

const DEFAULT_TAG = 'insight';

/**
 * If the model followed instructions, the answer is inside <insight>...</insight>.
 * @param {string} raw
 * @param {string} [tag]
 * @returns {string | null}
 */
export function extractTaggedInsight(raw, tag = DEFAULT_TAG) {
  const s = String(raw ?? '');
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = s.match(re);
  if (!m) return null;
  const inner = m[1].trim();
  return inner.length ? inner : null;
}

/**
 * Heuristic: drop leading lines that restate the task / numbered requirements (multiline responses).
 * @param {string} raw
 * @returns {string}
 */
export function stripExpertOverlapInstructionEcho(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return s;

  const lines = s.split(/\r?\n/);
  const badLine = (line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^The user wants\b/i.test(t)) return true;
    if (/^The key requirements\b/i.test(t)) return true;
    if (/^Key requirements\b/i.test(t)) return true;
    if (/^Looking at the JSON\b/i.test(t)) return true;
    if (/^###?\s*(Requirements|Data analysis|Congress|Structure)\b/i.test(t)) return true;
    if (/^\d+\.\s*(Output|Lead with|If the digest|Optionally|Never invent)\b/i.test(t)) return true;
    return false;
  };

  let i = 0;
  while (i < lines.length && badLine(lines[i])) i += 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;

  return lines.slice(i).join('\n').trim() || s;
}

/**
 * Prefer tagged body; otherwise strip known instruction-echo prefixes.
 * @param {string} raw
 * @returns {string}
 */
export function finalizeExpertOverlapInsightText(raw) {
  const tagged = extractTaggedInsight(raw);
  if (tagged) return tagged;
  return stripExpertOverlapInstructionEcho(raw);
}
