/**
 * Shared utilities for working with signal arrays.
 */

function normalizeDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  return null;
}

export function getSignalDateStr(signal) {
  return (
    normalizeDateStr(signal?.entryDate) ||
    normalizeDateStr(signal?.entry_date) ||
    normalizeDateStr(signal?.signalDateStr) ||
    normalizeDateStr(signal?.signalDate) ||
    normalizeDateStr(signal?.entryDateStr) ||
    null
  );
}

export function filterSignalsByDate(signals = [], startDate, endDate) {
  if (!startDate && !endDate) return signals;
  const start = startDate ? normalizeDateStr(startDate) : null;
  const end = endDate ? normalizeDateStr(endDate) : null;

  return signals.filter((signal) => {
    const dateStr = getSignalDateStr(signal);
    if (!dateStr) return false;
    if (start && dateStr < start) return false;
    if (end && dateStr > end) return false;
    return true;
  });
}
