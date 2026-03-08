export interface DashboardSortState {
  sortColumn: string
  sortDir: 'asc' | 'desc'
}

export function getNextSortState(
  current: DashboardSortState,
  clickedColumn: string,
): DashboardSortState
