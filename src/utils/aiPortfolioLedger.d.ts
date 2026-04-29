export type AiPortfolioLedgerLikeRow = {
  positionId?: string | null;
  ticker?: string | null;
  exitAt?: string | null;
  status?: string | null;
  realizedPnlUsd?: number | null;
};

/** Preserves element type while dropping orphaned open rows. */
export function filterStaleOpenLedgerRows<T extends AiPortfolioLedgerLikeRow>(
  rows: T[] | null | undefined,
): T[];

export function sumRealizedUsdClosedForSymbol(
  rows: AiPortfolioLedgerLikeRow[] | null | undefined,
  ticker: string,
): number;

export function netSymbolPnlUsd(
  unrealizedPnlUsd: number,
  ledgerRows: AiPortfolioLedgerLikeRow[] | null | undefined,
  ticker: string,
): number;