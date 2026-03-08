import assert from 'assert';
import { describe, it } from 'node:test';
import { resolveSignalAgentLabel, formatSignalDate, formatSignalPL } from './signalAgentDisplay.js';

describe('signalAgentDisplay helpers', () => {
  it('picks first matching agent label by priority', () => {
    // ma_crossover_10_20 removed; momentum_scout is first match in priority for this list
    assert.equal(resolveSignalAgentLabel(['ma_crossover_10_20', 'momentum_scout']), 'Momentum');
    assert.equal(resolveSignalAgentLabel(['unusual_vol', 'momentum_scout']), 'Unusual Vol.');
    assert.equal(resolveSignalAgentLabel(['base_hunter', 'momentum_scout']), 'Momentum');
    assert.equal(resolveSignalAgentLabel(['turtle_trader']), 'Turtle');
  });

  it('prefers active filter label when it matches row setups', () => {
    assert.equal(
      resolveSignalAgentLabel(['unusual_vol', 'momentum_scout'], 'unusual_vol'),
      'Unusual Vol.',
    );
    assert.equal(
      resolveSignalAgentLabel(['momentum_scout', 'base_hunter'], 'base_hunter'),
      'Base',
    );
  });

  it('formats entry date into YYYY-MM-DD', () => {
    const ms = new Date('2026-02-22T00:00:00Z').getTime();
    assert.equal(formatSignalDate(ms), '2026-02-22');
    assert.equal(formatSignalDate(ms / 1000), '2026-02-22');
    assert.equal(formatSignalDate('2026-02-22'), '2026-02-22');
    assert.equal(formatSignalDate(null), '—');
  });

  it('formats P/L with tone', () => {
    assert.deepEqual(formatSignalPL(5.2), { text: '+5.2%', tone: 'positive' });
    assert.deepEqual(formatSignalPL(-3.1), { text: '-3.1%', tone: 'negative' });
    assert.deepEqual(formatSignalPL(null), { text: '—', tone: 'muted' });
  });
});
