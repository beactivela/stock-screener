import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePerformancePageHtml } from './parsePerformancePage.js';

const sample = `<!DOCTYPE html><html><body>
  <h3 class="info-box__title">1-Year Performance</h3>
  <p class="info-box__value">58.58%</p>
  <h3 class="info-box__title">3-Year Performance</h3>
  <p class="info-box__value">162.10%</p>
  <h3 class="info-box__title">5-Year Performance</h3>
  <p class="info-box__value">127.82%</p>
  <h3 class="info-box__title">10-Year Performance</h3>
  <p class="info-box__value">419.06%</p>
</body></html>`;

test('parsePerformancePageHtml reads all horizons', () => {
  const p = parsePerformancePageHtml(sample);
  assert.equal(p.performance1yPct, 58.58);
  assert.equal(p.performance3yPct, 162.1);
  assert.equal(p.performance5yPct, 127.82);
  assert.equal(p.performance10yPct, 419.06);
});

test('parsePerformancePageHtml empty html returns nulls', () => {
  const p = parsePerformancePageHtml('<html></html>');
  assert.equal(p.performance1yPct, null);
  assert.equal(p.performance3yPct, null);
});
