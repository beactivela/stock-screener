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

/**
 * Returns the default sort for a selected Signal Agent filter.
 * - All: Opus score descending (strongest setups first)
 * - Others: score descending
 */
export function getDefaultSortForFilter(filterId) {
  if (filterId === 'all') {
    return { sortColumn: 'opus45', sortDir: 'desc' }
  }
  if (filterId === 'lance') {
    return { sortColumn: 'lance', sortDir: 'desc' }
  }
  return { sortColumn: 'score', sortDir: 'desc' }
}
