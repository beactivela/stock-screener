/**
 * Curated “Congress Trades” view: illustrative 1Y performance labels (ranges or point %)
 * for the All experts tab. Not populated from the live FMP sync — edit this list to update the UI.
 */
export interface CongressTradesLeaderboardRow {
  rank: number
  name: string
  /** Shown in the 1Y column — may be a range (e.g. "142-224%") or a single figure. */
  perf1y: string
}

export const CONGRESS_TRADES_LEADERBOARD: CongressTradesLeaderboardRow[] = [
  { rank: 1, name: 'Debbie Wasserman Schultz', perf1y: '142-224%' },
  { rank: 2, name: 'Nancy Pelosi', perf1y: '54-140%' },
  { rank: 3, name: 'Tim Moore', perf1y: '52-139%' },
  { rank: 4, name: 'Cleo Fields', perf1y: '96%' },
  { rank: 5, name: 'Pete Sessions', perf1y: '90%' },
  { rank: 6, name: 'Dan Crenshaw', perf1y: '60%' },
  { rank: 7, name: 'Ted Cruz', perf1y: '50%' },
  { rank: 8, name: 'Seth Moulton', perf1y: '45%' },
  { rank: 9, name: 'Tina Smith', perf1y: '44%' },
  { rank: 10, name: 'Byron Donalds', perf1y: '43%' },
  { rank: 11, name: 'John Curtis', perf1y: '43%' },
  { rank: 12, name: 'Marjorie Taylor Greene', perf1y: '33%' },
  { rank: 13, name: 'Tom Suozzi', perf1y: '35%' },
  { rank: 14, name: 'Steve Cohen', perf1y: '30%' },
  { rank: 15, name: 'Ro Khanna', perf1y: '28%' },
  { rank: 16, name: 'Josh Gottheimer', perf1y: '25%' },
  { rank: 17, name: 'Michael McCaul', perf1y: '24%' },
  { rank: 18, name: 'French Hill', perf1y: '22%' },
  { rank: 19, name: 'Mark Warner', perf1y: '20%' },
  { rank: 20, name: 'Rick Scott', perf1y: '0%' },
]
