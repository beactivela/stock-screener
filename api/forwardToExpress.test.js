import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatchAllApiPath, buildExpressProxyUrl } from './_forwardToExpress.js';

describe('buildExpressProxyUrl', () => {
  it('returns forced path without query when no original URL is present', () => {
    const out = buildExpressProxyUrl('/api/agents/optimize/batch', undefined);
    assert.equal(out, '/api/agents/optimize/batch');
  });

  it('preserves original query string', () => {
    const out = buildExpressProxyUrl('/api/agents/optimize/batch', '/api/foo?runId=abc&resume=true');
    assert.equal(out, '/api/agents/optimize/batch?runId=abc&resume=true');
  });

  it('handles urls containing multiple question marks safely', () => {
    const out = buildExpressProxyUrl('/api/agents/optimize', '/api/foo?x=1?y=2');
    assert.equal(out, '/api/agents/optimize?x=1?y=2');
  });
});

describe('buildCatchAllApiPath', () => {
  it('builds /api path with joined segments', () => {
    const out = buildCatchAllApiPath(['bars', '^GSPC']);
    assert.equal(out, '/api/bars/^GSPC');
  });

  it('builds /api path when path is string from rewrite', () => {
    const out = buildCatchAllApiPath('bars/^GSPC');
    assert.equal(out, '/api/bars/^GSPC');
  });

  it('falls back to /api when segments are missing', () => {
    assert.equal(buildCatchAllApiPath(undefined), '/api');
    assert.equal(buildCatchAllApiPath([]), '/api');
  });
});
