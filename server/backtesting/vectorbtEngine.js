import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { getBars } from '../db/bars.js';
import { normalizeEngineResult } from './engineContracts.js';

function groupSignalsByTicker(signals = []) {
  const byTicker = new Map();
  for (const signal of signals) {
    if (!signal?.ticker) continue;
    if (!byTicker.has(signal.ticker)) byTicker.set(signal.ticker, []);
    byTicker.get(signal.ticker).push(signal);
  }
  return byTicker;
}

function resolveDateStr(signal, fieldOptions) {
  for (const key of fieldOptions) {
    const value = signal?.[key];
    if (typeof value === 'string') return value.slice(0, 10);
  }
  return null;
}

async function runPythonVectorbt({ inputPath, pythonPath }) {
  const scriptPath = path.join(process.cwd(), 'server', 'backtesting', 'python', 'vectorbt_runner.py');
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [scriptPath, '--input', inputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        const message = stderr || stdout || `vectorbt runner failed (exit ${code})`;
        return reject(new Error(message));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Invalid vectorbt output: ${e.message}`));
      }
    });
  });
}

export async function runVectorbtEngine({
  signals = [],
  startDate,
  endDate,
  initCash = 100000,
  fees = 0,
  slippage = 0,
  pythonPath = 'python3',
}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');
  if (!Array.isArray(signals) || signals.length === 0) {
    throw new Error('vectorbt engine requires non-empty signals');
  }

  const byTicker = groupSignalsByTicker(signals);
  const warnings = [];
  const series = {};

  for (const [ticker, tickerSignals] of byTicker.entries()) {
    const bars = await getBars(ticker, startDate, endDate, '1d');
    if (!bars || bars.length === 0) {
      warnings.push(`No bars for ${ticker}`);
      continue;
    }

    const dateIndex = new Map();
    const dates = bars.map((b, i) => {
      const d = new Date(b.t).toISOString().slice(0, 10);
      dateIndex.set(d, i);
      return d;
    });
    const closes = bars.map((b) => b.c);
    const entries = new Array(bars.length).fill(0);
    const exits = new Array(bars.length).fill(0);

    for (const signal of tickerSignals) {
      const entryDate = resolveDateStr(signal, ['signalDateStr', 'entryDate', 'entryDateStr']);
      const exitDate = resolveDateStr(signal, ['exitDateStr', 'exitDate']);
      if (!entryDate || !exitDate) continue;
      const entryIdx = dateIndex.get(entryDate);
      const exitIdx = dateIndex.get(exitDate);
      if (entryIdx == null || exitIdx == null || exitIdx <= entryIdx) continue;
      entries[entryIdx] = 1;
      exits[exitIdx] = 1;
    }

    series[ticker] = {
      dates,
      close: closes,
      entries,
      exits,
    };
  }

  const payload = {
    init_cash: initCash,
    fees,
    slippage,
    series,
    meta: { startDate, endDate },
  };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectorbt-'));
  const inputPath = path.join(tmpDir, 'payload.json');
  await fs.writeFile(inputPath, JSON.stringify(payload), 'utf8');

  try {
    const raw = await runPythonVectorbt({ inputPath, pythonPath });
    const normalized = normalizeEngineResult({
      engine: 'vectorbt',
      raw,
      meta: { startDate, endDate, warnings },
    });
    return normalized;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
