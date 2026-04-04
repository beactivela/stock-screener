import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runDrawdownReversalStudy } from '../server/drawdownReversalStudy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const outputDir = path.join(__dirname, '..', 'docs', 'research');
  const maxTickers = Math.max(1, Number(process.env.STUDY_MAX_TICKERS) || 50);
  const tickersEnv = process.env.STUDY_TICKERS;
  const tickers = tickersEnv
    ? tickersEnv.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  console.log(
    `Running drawdown reversal study (maxTickers=${maxTickers}${tickers ? `, tickers=${tickers.join(',')}` : ''})...`
  );

  const study = await runDrawdownReversalStudy({
    outputDir,
    maxTickers,
    tickers,
    barsConcurrency: Math.max(1, Number(process.env.STUDY_BARS_CONCURRENCY) || 8),
    barsChunkSize: Math.max(50, Number(process.env.STUDY_BARS_CHUNK_SIZE) || 200),
    from: process.env.STUDY_FROM,
    to: process.env.STUDY_TO,
    onProgress: (progress) => {
      if (progress.stage === 'universe') {
        console.log(`Universe loaded=${progress.loaded}, using=${progress.using}`);
      } else if (progress.stage === 'bars') {
        console.log(
          `Bars ${progress.interval || ''} ${progress.processed}/${progress.total} (loaded=${progress.loaded})`
        );
      }
    },
  });

  console.log('Drawdown reversal study complete.');
  console.log(`Episodes: ${study.aggregates.totalEpisodes} | Tickers with episodes: ${study.aggregates.tickersWithEpisodes}`);
  if (study.outputs) {
    console.log(`JSON: ${study.outputs.jsonPath}`);
    console.log(`Report: ${study.outputs.mdPath}`);
  }
}

main().catch((error) => {
  console.error('Drawdown reversal study failed:', error?.message || String(error));
  process.exit(1);
});
