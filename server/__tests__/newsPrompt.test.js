import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsPrompt } from '../../src/utils/newsPrompt.js';

test('buildNewsPrompt includes ticker, date, and headlines', () => {
  const prompt = buildNewsPrompt({
    ticker: 'LSCC',
    date: '2025-09-19',
    volumeContext: { volume: 1200000, avgVolume: 500000, ratio: 2.4, close: 56.12, changePct: 7.2 },
    articles: [
      { title: 'Lattice Semi spikes on earnings', url: 'https://example.com/a', source: 'yahoo-finance' },
      { title: 'LSCC announces new FPGA', url: 'https://example.com/b', source: 'yahoo-finance' },
    ],
  });

  assert.match(prompt, /LSCC/);
  assert.match(prompt, /2025-09-19/);
  assert.match(prompt, /Lattice Semi spikes on earnings/);
  assert.match(prompt, /announces new FPGA/);
  assert.match(prompt, /Volume/);
});

test('buildNewsPrompt handles missing articles gracefully', () => {
  const prompt = buildNewsPrompt({
    ticker: 'LSCC',
    date: '2025-09-19',
    articles: [],
  });

  assert.match(prompt, /No relevant news found/);
});
