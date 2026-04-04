/**
 * Map StockCircle "Last transaction" English text to DB action_type + optional %.
 */

/**
 * @param {string} line e.g. "Sold 21.9% shares", "New holding", "Increased shares by 68.8%"
 * @returns {{ action_type: string, action_pct: number | null }}
 */
export function classifyActionLine(line) {
  const t = String(line || '').trim();
  if (!t) return { action_type: 'unknown', action_pct: null };

  if (/^new holding$/i.test(t)) {
    return { action_type: 'new_holding', action_pct: null };
  }

  let m = t.match(/^increased shares by ([\d.]+)%/i);
  if (m) {
    return { action_type: 'increased', action_pct: parseFloat(m[1]) };
  }

  m = t.match(/^sold ([\d.]+)% shares$/i);
  if (m) {
    return { action_type: 'sold', action_pct: parseFloat(m[1]) };
  }

  m = t.match(/^decreased shares by ([\d.]+)%/i);
  if (m) {
    return { action_type: 'decreased', action_pct: parseFloat(m[1]) };
  }

  return { action_type: 'unknown', action_pct: null };
}
