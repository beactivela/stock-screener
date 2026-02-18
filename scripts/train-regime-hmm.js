/**
 * Train separate SPY and QQQ regime HMMs; write model_*.json and current_*.json (with predictions).
 * Run after: npm run fetch-regime-data
 * Usage: node scripts/train-regime-hmm.js
 */

import { trainAndSave } from '../server/regimeHmm.js';

async function main() {
  console.log('Training separate SPY and QQQ regime HMMs (2 states, 2-D each)...');
  const result = await trainAndSave({ seed: 42 });
  console.log('SPY:', result.SPY.currentRegime, result.SPY.converged ? '(converged)' : '');
  console.log('QQQ:', result.QQQ.currentRegime, result.QQQ.converged ? '(converged)' : '');
  console.log('Saved data/regime/model_spy.json, model_qqq.json, current_spy.json, current_qqq.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
