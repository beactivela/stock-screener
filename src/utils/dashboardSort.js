/**
 * Returns the next sort state for a column-header click.
 * - Clicking the active column toggles asc/desc.
 * - Switching columns uses asc for ticker and desc for everything else.
 */
export function getNextSortState(current, clickedColumn) {
  if (current.sortColumn === clickedColumn) {
    return {
      sortColumn: current.sortColumn,
      sortDir: current.sortDir === 'asc' ? 'desc' : 'asc',
    }
  }
  return {
    sortColumn: clickedColumn,
    sortDir: clickedColumn === 'ticker' ? 'asc' : 'desc',
  }
}
