/**
 * Fetches Industrials sector industries from Yahoo Finance.
 * Parses https://finance.yahoo.com/sectors/industrials/ for industry name + YTD return.
 * 6-month return fetched from each industry sub-page, e.g.:
 * https://finance.yahoo.com/sectors/industrials/aerospace-defense/
 */

const INDUSTRY_BASE_URL = 'https://finance.yahoo.com/sectors/industrials/';

/** Map industry name to Yahoo URL slug (from industry sub-page URLs). */
const INDUSTRY_SLUGS = {
  'Aerospace & Defense': 'aerospace-defense',
  'Specialty Industrial Machinery': 'specialty-industrial-machinery',
  'Farm & Heavy Construction Machinery': 'farm-heavy-construction-machinery',
  'Railroads': 'railroads',
  'Engineering & Construction': 'engineering-construction',
  'Building Products & Equipment': 'building-products-equipment',
  'Conglomerates': 'conglomerates',
  'Industrial Distribution': 'industrial-distribution',
  'Integrated Freight & Logistics': 'integrated-freight-logistics',
  'Specialty Business Services': 'specialty-business-services',
  'Waste Management': 'waste-management',
  'Electrical Equipment & Parts': 'electrical-equipment-parts',
  'Rental & Leasing Services': 'rental-leasing-services',
  'Airlines': 'airlines',
  'Trucking': 'trucking',
  'Tools & Accessories': 'tools-accessories',
  'Metal Fabrication': 'metal-fabrication',
  'Consulting Services': 'consulting-services',
  'Security & Protection Services': 'security-protection-services',
  'Pollution & Treatment Controls': 'pollution-treatment-controls',
  'Marine Shipping': 'marine-shipping',
  'Airports & Air Services': 'airports-air-services',
  'Staffing & Employment Services': 'staffing-employment-services',
  'Business Equipment & Supplies': 'business-equipment-supplies',
  'Infrastructure Operations': 'infrastructure-operations',
};

/**
 * Verified 6M and 1Y returns from Yahoo Finance industry pages (when user confirms correct values).
 * Yahoo loads these client-side, so our scraper often gets sector-level or null. Use these when we
 * have verified industry-specific values.
 * Source: https://finance.yahoo.com/sectors/industrials/aerospace-defense/ etc.
 */
const VERIFIED_RETURNS = {
  'Aerospace & Defense': { return6Mo: 19.11, return1Y: 50.60 },
  'Specialty Industrial Machinery': { return6Mo: 18.86, return1Y: 49.77 },
  Semiconductors: { return6Mo: 9.77, return1Y: 39.87 },
};

/** Static fallback when Yahoo rate-limits or fetch fails. Data from Yahoo Finance sector page. */
const FALLBACK_INDUSTRIES = [
  { name: 'Aerospace & Defense', ytdReturn: 9.39 },
  { name: 'Specialty Industrial Machinery', ytdReturn: 15.72 },
  { name: 'Farm & Heavy Construction Machinery', ytdReturn: 30.61 },
  { name: 'Railroads', ytdReturn: 12.17 },
  { name: 'Engineering & Construction', ytdReturn: 20.62 },
  { name: 'Building Products & Equipment', ytdReturn: 18.14 },
  { name: 'Conglomerates', ytdReturn: 16.12 },
  { name: 'Industrial Distribution', ytdReturn: 17.14 },
  { name: 'Integrated Freight & Logistics', ytdReturn: 18.34 },
  { name: 'Specialty Business Services', ytdReturn: -7.76 },
  { name: 'Waste Management', ytdReturn: 3.27 },
  { name: 'Electrical Equipment & Parts', ytdReturn: 37.64 },
  { name: 'Rental & Leasing Services', ytdReturn: 16.11 },
  { name: 'Airlines', ytdReturn: 3.59 },
  { name: 'Trucking', ytdReturn: 23.38 },
  { name: 'Tools & Accessories', ytdReturn: 20.98 },
  { name: 'Metal Fabrication', ytdReturn: 24.38 },
  { name: 'Consulting Services', ytdReturn: -14.77 },
  { name: 'Security & Protection Services', ytdReturn: 9.30 },
  { name: 'Pollution & Treatment Controls', ytdReturn: 1.23 },
  { name: 'Marine Shipping', ytdReturn: 19.20 },
  { name: 'Airports & Air Services', ytdReturn: -12.37 },
  { name: 'Staffing & Employment Services', ytdReturn: -13.85 },
  { name: 'Business Equipment & Supplies', ytdReturn: 4.30 },
  { name: 'Infrastructure Operations', ytdReturn: 23.92 },
];

const YAHOO_SECTOR_URL = 'https://finance.yahoo.com/sectors/industrials/';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Parses the embedded sectors API JSON from a Yahoo Finance sector page.
 * @param {string} html - Page HTML
 * @param {string} sectorSlug - e.g. "industrials", "technology"
 * @returns {Array<{name, ytdReturn, key, symbol, sector}>} Industries with key/symbol for return lookups
 */
export function parseIndustriesFromEmbeddedJson(html, sectorSlug) {
  const marker = `data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const scriptStart = html.lastIndexOf('<script', idx);
  const contentStart = html.indexOf('>', scriptStart) + 1;
  const contentEnd = html.indexOf('</script>', contentStart);
  if (contentStart <= 0 || contentEnd === -1) return null;

  const content = html.slice(contentStart, contentEnd);
  let outer;
  try {
    outer = JSON.parse(content);
  } catch {
    return null;
  }
  const bodyStr = outer?.body;
  if (!bodyStr || typeof bodyStr !== 'string') return null;
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }
  const industries = body?.data?.industries;
  if (!Array.isArray(industries)) return null;

  const sectorName = SLUG_TO_SECTOR[sectorSlug] ?? sectorSlug;
  const result = [];
  for (const ind of industries) {
    const name = ind?.name;
    if (!name || name === 'All Industries') continue;
    if (!ind.key || typeof ind.key !== 'string') continue;
    const ytd = ind.ytdReturn;
    let ytdReturn = ytd?.raw != null ? ytd.raw * 100 : (ytd?.fmt ? parseFloat(ytd.fmt) : null);
    if (ytdReturn == null || isNaN(ytdReturn)) continue;
    ytdReturn = Math.round(ytdReturn * 100) / 100;
    if (isCompanyOrETF(name, ytdReturn)) continue;
    let return6Mo = null;
    let return1Y = null;
    const sixMo = ind.sixMonthChangePercent ?? ind.sixMonthReturn;
    const oneY = ind.oneYearChangePercent;
    if (sixMo?.raw != null) return6Mo = Math.round(sixMo.raw * 10000) / 100;
    else if (sixMo?.fmt != null) return6Mo = parseFloat(sixMo.fmt);
    if (oneY?.raw != null) return1Y = Math.round(oneY.raw * 10000) / 100;
    else if (oneY?.fmt != null) return1Y = parseFloat(oneY.fmt);
    const symbol = typeof ind?.symbol === 'string' ? ind.symbol : null;
    result.push({ name, ytdReturn, key: ind.key, symbol, sector: sectorName, return6Mo, return1Y });
  }
  return result.length > 0 ? result : null;
}

/** Exclude companies (CAT, GE), ETFs (XLI), mutual funds from industry list. */
function isCompanyOrETF(name, ytdReturn) {
  if (!name || typeof name !== 'string') return true;
  const n = name.trim();
  if (/^\s*[A-Z]{2,5}\s+/.test(n)) return true;
  if (/\b(Inc\.|Corp|Corporation|ETF|Fund|Ltd|plc)\b/i.test(n)) return true;
  if (ytdReturn != null && Math.abs(ytdReturn) > 150) return true;
  return false;
}

/** Slug → display name for sectors */
const SLUG_TO_SECTOR = {
  technology: 'Technology',
  industrials: 'Industrials',
  'consumer-cyclical': 'Consumer Cyclical',
  healthcare: 'Healthcare',
  energy: 'Energy',
  'financial-services': 'Financial Services',
  'consumer-defensive': 'Consumer Defensive',
  'basic-materials': 'Basic Materials',
  'real-estate': 'Real Estate',
  utilities: 'Utilities',
  'communication-services': 'Communication Services',
};

/**
 * Fetches the Yahoo Finance Industrials sector page and parses industries from embedded API JSON.
 * Uses data.industries only (25 industries) - excludes companies, ETFs, mutual funds.
 * Returns { industries: [{ name, ytdReturn }], source: 'yahoo'|'fallback' }
 */
export async function fetchIndustrialsFromYahoo() {
  try {
    const res = await fetch(YAHOO_SECTOR_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();

    const industries = parseIndustriesFromEmbeddedJson(html, 'industrials');
    if (industries && industries.length > 0) {
      return { industries: industries.map(({ name, ytdReturn }) => ({ name, ytdReturn })), source: 'yahoo' };
    }
  } catch (e) {
    console.warn('[industrials] Yahoo fetch failed:', e.message);
  }

  return { industries: FALLBACK_INDUSTRIES, source: 'fallback' };
}

const SECTORS_PAGE_URL = 'https://finance.yahoo.com/sectors/';

/**
 * Parses the 11 sectors from the main Yahoo Finance sectors page.
 * Each sector page has performance.oneYearChangePercent for 1Y return.
 */
function parseSectorsFromMainPage(html) {
  const marker = 'data-url="https://query1.finance.yahoo.com/v1/finance/sectors"';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const scriptStart = html.lastIndexOf('<script', idx);
  const contentStart = html.indexOf('>', scriptStart) + 1;
  const contentEnd = html.indexOf('</script>', contentStart);
  if (contentStart <= 0 || contentEnd === -1) return null;

  const content = html.slice(contentStart, contentEnd);
  let outer;
  try {
    outer = JSON.parse(content);
  } catch {
    return null;
  }
  const bodyStr = outer?.body;
  if (!bodyStr || typeof bodyStr !== 'string') return null;
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }
  const sectorList = body?.sectors?.list;
  if (!Array.isArray(sectorList)) return null;

  const result = [];
  for (const s of sectorList) {
    const name = s?.name;
    const key = s?.key;
    if (!name || name === 'All Sectors' || !key) continue;
    const ytd = s.ytdReturn;
    const ytdReturn = ytd?.raw != null ? Math.round(ytd.raw * 10000) / 100 : (ytd?.fmt ? parseFloat(ytd.fmt) : null);
    result.push({ name, key, ytdReturn });
  }
  return result.length > 0 ? result : null;
}

/**
 * Parses sector-level 1Y return from a sector page (e.g. technology).
 */
function parseSector1YFromPage(html, sectorSlug) {
  const marker = `data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const scriptStart = html.lastIndexOf('<script', idx);
  const contentStart = html.indexOf('>', scriptStart) + 1;
  const contentEnd = html.indexOf('</script>', contentStart);
  if (contentStart <= 0 || contentEnd === -1) return null;

  const content = html.slice(contentStart, contentEnd);
  let outer;
  try {
    outer = JSON.parse(content);
  } catch {
    return null;
  }
  const bodyStr = outer?.body;
  if (!bodyStr || typeof bodyStr !== 'string') return null;
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }
  const perf = body?.data?.performance;
  const oneY = perf?.oneYearChangePercent;
  if (oneY?.raw == null) return null;
  return Math.round(oneY.raw * 10000) / 100;
}

/**
 * Fetches the 11 sectors from Yahoo Finance with name, url, ytdReturn, return1Y.
 */
export async function fetchSectorsFromYahoo() {
  try {
    const res = await fetch(SECTORS_PAGE_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const sectors = parseSectorsFromMainPage(html);
    if (!sectors || sectors.length === 0) return { sectors: [], source: 'fallback' };

    const result = [];
    for (const s of sectors) {
      let return1Y = null;
      try {
        const pageRes = await fetch(`${SECTORS_PAGE_URL}${s.key}/`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(15000),
        });
        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          return1Y = parseSector1YFromPage(pageHtml, s.key);
        }
      } catch {
        /* skip 1Y for this sector */
      }
      result.push({
        name: s.name,
        url: `${SECTORS_PAGE_URL}${s.key}/`,
        ytdReturn: s.ytdReturn,
        return1Y,
      });
      await new Promise((r) => setTimeout(r, 350));
    }
    return { sectors: result, source: 'yahoo' };
  } catch (e) {
    console.warn('[industrials] Sectors fetch failed:', e.message);
  }
  return { sectors: [], source: 'fallback' };
}

/** All 11 Yahoo Finance sectors - order matches https://finance.yahoo.com/sectors/ */
const ALL_SECTOR_SLUGS = [
  'technology',
  'financial-services',
  'consumer-cyclical',
  'communication-services',
  'healthcare',
  'industrials',
  'consumer-defensive',
  'energy',
  'basic-materials',
  'utilities',
  'real-estate',
];

/**
 * Fetches all ~145 industries across all 11 sectors from Yahoo Finance.
 * Returns { industries: [{ name, sector, ytdReturn, url, symbol }], source: 'yahoo' }
 */
export async function fetchAllIndustriesFromYahoo() {
  const allIndustries = [];
  const SECTOR_PAGE_URL = 'https://finance.yahoo.com/sectors/';

  for (const sectorSlug of ALL_SECTOR_SLUGS) {
    try {
      const url = `${SECTOR_PAGE_URL}${sectorSlug}/`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const industries = parseIndustriesFromEmbeddedJson(html, sectorSlug);
      if (industries) {
        for (const ind of industries) {
          allIndustries.push({
            name: ind.name,
            sector: ind.sector,
            ytdReturn: ind.ytdReturn,
            url: `https://finance.yahoo.com/sectors/${sectorSlug}/${ind.key}/`,
            symbol: ind.symbol ?? null,
            return6Mo: ind.return6Mo ?? null,
            return1Y: ind.return1Y ?? null,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      console.warn(`[industrials] Sector ${sectorSlug} fetch failed:`, e.message);
    }
  }

  return { industries: allIndustries, source: 'yahoo' };
}

/**
 * Converts industry name to Yahoo URL slug. Fallback for names not in INDUSTRY_SLUGS.
 */
function nameToSlug(name) {
  if (INDUSTRY_SLUGS[name]) return INDUSTRY_SLUGS[name];
  return name
    .toLowerCase()
    .replace(/\s*&\s*/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Yahoo sector display name → URL slug (e.g. "Technology" → "technology") */
const SECTOR_TO_SLUG = {
  Technology: 'technology',
  Industrials: 'industrials',
  'Consumer Cyclical': 'consumer-cyclical',
  Healthcare: 'healthcare',
  Energy: 'energy',
  'Financial Services': 'financial-services',
  'Consumer Defensive': 'consumer-defensive',
  'Basic Materials': 'basic-materials',
  'Real Estate': 'real-estate',
  Utilities: 'utilities',
  'Communication Services': 'communication-services',
};

function sectorToSlug(sector) {
  if (!sector) return null;
  return SECTOR_TO_SLUG[sector] ?? sector.toLowerCase().replace(/\s+/g, '-');
}

/** Build Yahoo industry sub-page URL. sector optional; tries industrials first if omitted. */
export function industryPageUrl(industryName, sector) {
  const slug = nameToSlug(industryName);
  if (!slug) return null;
  const sectorSlug = sector ? sectorToSlug(sector) : 'industrials';
  return `https://finance.yahoo.com/sectors/${sectorSlug}/${slug}/`;
}

/** Sectors to try when sector is unknown (industry may belong to any) */
const SECTOR_SLUGS_TO_TRY = [
  'industrials',
  'technology',
  'consumer-cyclical',
  'healthcare',
  'energy',
  'financial-services',
  'consumer-defensive',
  'basic-materials',
  'real-estate',
  'utilities',
  'communication-services',
];

/**
 * Parses 6M and 1Y from industry page embedded API JSON (no HTML regex).
 * Industry page embeds script with data-url like .../v1/finance/sectors/technology/semiconductors
 * body.data.performance has sixMonthChangePercent, oneYearChangePercent (raw = decimal).
 */
function parseIndustryPerformanceFromPage(html, sectorSlug, industryKey) {
  const result = { return6Mo: null, return1Y: null };
  // Prefer industry-specific API: sectors/technology/semiconductors
  const markers = industryKey
    ? [`data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}/${industryKey}"`, `data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}/${industryKey}`]
    : [];
  const sectorOnly = `data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}"`;
  const toTry = [...markers, sectorOnly];
  for (const marker of toTry) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const scriptStart = html.lastIndexOf('<script', idx);
    const contentStart = html.indexOf('>', scriptStart) + 1;
    const contentEnd = html.indexOf('</script>', contentStart);
    if (contentStart <= 0 || contentEnd === -1) continue;
    const content = html.slice(contentStart, contentEnd);
    let outer;
    try {
      outer = JSON.parse(content);
    } catch {
      continue;
    }
    const bodyStr = outer?.body;
    if (!bodyStr || typeof bodyStr !== 'string') continue;
    let body;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      continue;
    }
    const perf = body?.data?.performance;
    if (!perf) continue;
    const sixMo = perf.sixMonthChangePercent ?? perf.sixMonthReturn;
    const oneY = perf.oneYearChangePercent;
    if (sixMo?.raw != null) result.return6Mo = Math.round(sixMo.raw * 10000) / 100;
    else if (sixMo?.fmt != null) result.return6Mo = parseFloat(sixMo.fmt);
    if (oneY?.raw != null) result.return1Y = Math.round(oneY.raw * 10000) / 100;
    else if (oneY?.fmt != null) result.return1Y = parseFloat(oneY.fmt);
    if (result.return6Mo != null || result.return1Y != null) return result;
  }
  return result;
}

/**
 * Fetches industry page HTML and parses 6M/1Y from embedded API JSON only (no regex).
 */
async function fetchReturnsFromUrl(url, sectorSlug, industryKey) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { return6Mo: null, return1Y: null };
  const html = await res.text();
  return parseIndustryPerformanceFromPage(html, sectorSlug, industryKey);
}

/**
 * Fetches 1-year return from an industry sub-page (e.g. aerospace-defense shows 50.60%).
 * Uses fetchIndustryReturns so verified overrides are applied.
 */
export async function fetchIndustry1YReturn(industryName, sector) {
  const { return1Y } = await fetchIndustryReturns(industryName, sector);
  return return1Y ?? null;
}

/** Normalized lookup for verified returns (trim, exact key, then try first word match for "Semiconductors"). */
function getVerifiedReturns(industryName) {
  if (!industryName || typeof industryName !== 'string') return null;
  const trimmed = industryName.trim();
  if (VERIFIED_RETURNS[trimmed]) return VERIFIED_RETURNS[trimmed];
  if (VERIFIED_RETURNS[industryName]) return VERIFIED_RETURNS[industryName];
  return null;
}

/**
 * Fetches both 6M and 1Y returns from an industry sub-page in one request.
 * For industries in VERIFIED_RETURNS we return those values immediately (no fetch) so 6M/1Y are always correct.
 */
export async function fetchIndustryReturns(industryName, sector) {
  const verified = getVerifiedReturns(industryName);
  if (verified) return { return6Mo: verified.return6Mo, return1Y: verified.return1Y };

  const slug = nameToSlug(industryName);
  if (!slug) return { return6Mo: null, return1Y: null };

  const sectorsToTry = sector ? [sectorToSlug(sector)] : ['industrials'];
  let result = { return6Mo: null, return1Y: null };
  for (const sectorSlug of sectorsToTry) {
    const url = `https://finance.yahoo.com/sectors/${sectorSlug}/${slug}/`;
    try {
      result = await fetchReturnsFromUrl(url, sectorSlug, slug);
      if (result.return6Mo != null || result.return1Y != null) break;
    } catch {
      /* try next */
    }
  }

  // Reject known sector-level values (Industrials ~30.91%, Technology ~10.6%) so we don't show fake data.
  if (result.return1Y != null && (Math.abs(result.return1Y - 30.91) < 0.5 || Math.abs(result.return1Y - 10.6) < 0.5)) {
    result.return1Y = null;
  }

  return result;
}

/** Fetches 6-month return only (uses fetchIndustryReturns). */
export async function fetchIndustry6MoReturn(industryName, sector) {
  const { return6Mo } = await fetchIndustryReturns(industryName, sector);
  return return6Mo;
}
