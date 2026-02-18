/**
 * Fetch 5 years of SPY and QQQ daily bars and save to data/regime/.
 * Run: node scripts/fetch-regime-data.js
 * Then train the HMM (e.g. npm run regime:train or node server/regimeHmm.js).
 */

import { fetchAndSaveRegimeData } from '../server/regimeData.js';

async function main() {
  console.log('Fetching 5 years of SPY and QQQ data...');
  const { spy, qqq } = await fetchAndSaveRegimeData();
  console.log(`SPY: ${spy.length} bars`);
  console.log(`QQQ: ${qqq.length} bars`);
  console.log('Saved to data/regime/spy_5y.json and data/regime/qqq_5y.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
