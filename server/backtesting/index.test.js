/**
 * Unit tests for backtesting hierarchy entrypoint
 * Run: node --test server/backtesting/index.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runBacktestHierarchy } from './index.js';

describe('runBacktestHierarchy', () => {
  it('throws when agentType is missing', async () => {
    await assert.rejects(
      () => runBacktestHierarchy({ tier: 'wfo' }),
      /agentType is required/i,
    );
  });

  it('throws when agentType is unknown', async () => {
    await assert.rejects(
      () => runBacktestHierarchy({ tier: 'simple', agentType: 'unknown_agent' }),
      /unknown agenttype/i,
    );
  });
});
