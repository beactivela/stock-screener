/**
 * Unit tests for progress helper
 * Run: node --test server/backtesting/progress.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createStepProgress } from './progress.js';

describe('createStepProgress', () => {
  it('emits incremental progress with labels', () => {
    const events = [];
    const progress = createStepProgress({
      tier: 'wfo',
      totalSteps: 3,
      onProgress: (evt) => events.push(evt),
    });

    progress.step('Window 1');
    progress.step('Window 2');
    progress.step('Window 3');

    assert.strictEqual(events.length, 3);
    assert.deepStrictEqual(events[0], { tier: 'wfo', current: 1, total: 3, label: 'Window 1' });
    assert.deepStrictEqual(events[2], { tier: 'wfo', current: 3, total: 3, label: 'Window 3' });
  });

  it('allows manual emit without increment', () => {
    const events = [];
    const progress = createStepProgress({
      tier: 'simple',
      totalSteps: 2,
      onProgress: (evt) => events.push(evt),
    });

    progress.emit('Starting');
    progress.step('Node');

    assert.strictEqual(events[0].current, 0);
    assert.strictEqual(events[0].label, 'Starting');
    assert.strictEqual(events[1].current, 1);
  });

  it('does not throw when onProgress is missing', () => {
    const progress = createStepProgress({
      tier: 'simple',
      totalSteps: 1,
      onProgress: null,
    });

    assert.doesNotThrow(() => progress.step('Done'));
  });
});
