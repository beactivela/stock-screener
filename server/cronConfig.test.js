import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCronSecret,
  getCronBaseUrl,
  getCronBarsChunk,
  getCronStatusPayload,
} from './cronConfig.js';

describe('cronConfig', () => {
  const keys = ['CRON_SECRET', 'CRON_BASE_URL', 'HOST_PORT', 'CRON_BARS_CHUNK', 'NODE_ENV'];
  const snapshot = {};

  beforeEach(() => {
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('getCronSecret returns undefined when unset', () => {
    assert.equal(getCronSecret(), undefined);
  });

  it('getCronSecret trims', () => {
    process.env.CRON_SECRET = '  abc  ';
    assert.equal(getCronSecret(), 'abc');
  });

  it('getCronBaseUrl prefers CRON_BASE_URL and strips trailing slash', () => {
    process.env.CRON_BASE_URL = 'http://127.0.0.1:9090/';
    assert.equal(getCronBaseUrl(), 'http://127.0.0.1:9090');
  });

  it('getCronBaseUrl falls back to HOST_PORT then default', () => {
    process.env.HOST_PORT = '3000';
    assert.equal(getCronBaseUrl(), 'http://127.0.0.1:3000');
  });

  it('getCronBarsChunk has minimum 10', () => {
    process.env.CRON_BARS_CHUNK = '3';
    assert.equal(getCronBarsChunk(), 10);
  });

  it('getCronStatusPayload never includes secret value', () => {
    process.env.CRON_SECRET = 'super-secret';
    process.env.NODE_ENV = 'production';
    const p = getCronStatusPayload();
    assert.equal(p.secretConfigured, true);
    assert.equal(p.cronAuthRequired, true);
    assert.ok(!JSON.stringify(p).includes('super-secret'));
  });
});
