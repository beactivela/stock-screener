import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runBreakoutGainersStudy } from '../server/breakoutGainersStudy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const outputDir = path.join(__dirname, '..', 'docs', 'research');
  const maxTickers = Math.max(100, Number(process.env.STUDY_MAX_TICKERS) || 1200);
  console.log(`Running breakout study (maxTickers=${maxTickers})...`);
  const study = await runBreakoutGainersStudy({
    outputDir,
    maxTickers,
    barsConcurrency: Math.max(1, Number(process.env.STUDY_BARS_CONCURRENCY) || 8),
    barsChunkSize: Math.max(50, Number(process.env.STUDY_BARS_CHUNK_SIZE) || 200),
    onProgress: (progress) => {
      if (progress.stage === 'universe') {
        console.log(`Universe loaded=${progress.loaded}, using=${progress.using}`);
      } else if (progress.stage === 'bars') {
        console.log(`Bars ${progress.processed}/${progress.total} (loaded=${progress.loaded})`);
      } else if (progress.stage === 'fundamentals') {
        console.log(`Hydrating fundamentals for ${progress.winners} winners`);
      } else if (progress.stage === 'exchange') {
        console.log(`Exchange metadata ${progress.processed}/${progress.total}`);
      }
    },
  });

  console.log('Top 100 Breakout Gainers study complete.');
  console.log(`Universe scanned: ${study.meta.universeCount}`);
  for (const period of study.periods) {
    console.log(
      `${period.key}: ${period.top100.length} winners | Nasdaq ${period.summary.exchangeBreakdown.NASDAQ || 0} | Median gain ${period.summary.medianGainPct ?? 'n/a'}%`
    );
  }
  if (study.outputs) {
    console.log(`JSON: ${study.outputs.jsonPath}`);
    console.log(`Report: ${study.outputs.mdPath}`);
  }
}

main().catch((error) => {
  console.error('Breakout study failed:', error?.message || String(error));
  process.exit(1);
});
