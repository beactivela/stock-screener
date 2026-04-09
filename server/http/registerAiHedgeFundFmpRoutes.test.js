/**
 * Smoke: FMP proxy route is registered and returns JSON (plan error OK without FMP_API_KEY).
 */
import assert from 'node:assert';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { registerAiHedgeFundFmpRoutes } from './registerAiHedgeFundFmpRoutes.js';

test('GET /api/ai-hedge-fund/fmp/profile returns JSON envelope', async () => {
  const app = express();
  registerAiHedgeFundFmpRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/ai-hedge-fund/fmp/profile?symbol=AAPL`, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
        .on('error', reject);
    });
    const j = JSON.parse(body);
    assert.ok('ok' in j);
    if (!j.ok) {
      assert.ok(typeof j.error === 'string');
    } else {
      assert.ok(j.data !== undefined);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
