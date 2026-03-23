export function getDefaultDateRange(years = 5) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - years);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function parseCsvQuery(value) {
  if (Array.isArray(value)) return value.flatMap((item) => parseCsvQuery(item) || []);
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

export function parseBooleanQuery(value, defaultValue = false) {
  if (value == null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}
