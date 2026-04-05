/**
 * Map Hedgefollow CSV exports (manager/fund rows) to WhaleWisdom /filer/ slugs for WHALEWISDOM_FILER_SLUGS.
 * Hedgefollow is not scraped by the app; this is an offline helper after you export CSV.
 */

/** @type {Record<string, string>} normalized manager key -> WW slug */
export const DEFAULT_MANAGER_KEY_TO_SLUG = {
  'leopold aschenbrenner': 'situational-awareness-lp',
};

/**
 * @param {string} name
 */
export function normalizeManagerKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Parse one CSV line with quoted fields (commas inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((s) => s.trim());
}

/**
 * Hedgefollow may prefix the file with a subscription notice; we skip until a header row.
 * @param {string} text full file contents
 * @returns {{ header: string[], rows: Array<{ fields: string[], fundIdx: number, managerIdx: number }> }}
 */
export function parseHedgefollowCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('fund_name') && lower.includes('manager_name')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Hedgefollow CSV: missing header row with fund_name and manager_name');
  }
  const header = parseCsvLine(lines[headerIdx]);
  const fundIdx = header.findIndex((h) => h.toLowerCase() === 'fund_name');
  const managerIdx = header.findIndex((h) => h.toLowerCase() === 'manager_name');
  if (fundIdx < 0 || managerIdx < 0) {
    throw new Error('Hedgefollow CSV: could not find fund_name / manager_name columns');
  }

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('This sample')) continue;
    const fields = parseCsvLine(line);
    if (fields.length < Math.max(fundIdx, managerIdx) + 1) continue;
    rows.push(fields);
  }
  return { header, rows: rows.map((fields) => ({ fields, fundIdx, managerIdx })) };
}

/**
 * @param {Array<{ fields: string[], fundIdx: number, managerIdx: number }>} parsedRows from parseHedgefollowCsv
 * @param {Record<string, string>} managerKeyToSlug normalized manager -> slug; merged with defaults
 * @returns {{ slugs: string[], unknown: { fundName: string, managerName: string }[] }}
 */
/**
 * @param {Record<string, string>} raw keys may be any casing (e.g. JSON "Leopold Aschenbrenner")
 * @returns {Record<string, string>} normalized manager key -> slug
 */
export function normalizeManagerSlugOverrides(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (v == null || String(v).trim() === '') continue;
    out[normalizeManagerKey(k)] = String(v).trim();
  }
  return out;
}

export function mapHedgefollowRowsToWhalewisdomSlugs(parsedRows, managerKeyToSlug = {}) {
  const merged = { ...DEFAULT_MANAGER_KEY_TO_SLUG, ...normalizeManagerSlugOverrides(managerKeyToSlug) };
  const slugSet = new Set();
  const unknown = [];

  for (const row of parsedRows) {
    const fundName = row.fields[row.fundIdx] ?? '';
    const managerName = row.fields[row.managerIdx] ?? '';
    const key = normalizeManagerKey(managerName);
    const slug = merged[key];
    if (slug && typeof slug === 'string') {
      slugSet.add(slug.trim().toLowerCase());
    } else {
      unknown.push({ fundName, managerName });
    }
  }

  return { slugs: [...slugSet].sort(), unknown };
}
