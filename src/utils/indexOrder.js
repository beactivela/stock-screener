/**
 * Return tickers ordered with selected first (if present).
 * @param {string | null} selected
 * @param {string[]} tickers
 */
export function getIndexStackOrder(selected, tickers) {
  if (!selected || !tickers.includes(selected)) return tickers
  return [selected, ...tickers.filter((t) => t !== selected)]
}
