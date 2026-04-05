import { describe, it } from 'node:test';
import assert from 'node:assert';
import { stripConsensusBuysNarrativeLeadIn } from './generateConsensusBuysInsights.js';

describe('stripConsensusBuysNarrativeLeadIn', () => {
  it('removes a lone thought line before prose', () => {
    assert.equal(
      stripConsensusBuysNarrativeLeadIn('thought\n\nRecent expert filings reveal.'),
      'Recent expert filings reveal.'
    );
  });

  it('removes Thinking: style prefixes', () => {
    assert.equal(
      stripConsensusBuysNarrativeLeadIn('Thinking:\nRecent moves.'),
      'Recent moves.'
    );
  });

  it('leaves normal columns unchanged', () => {
    const s = 'AAPL (Apple Inc.)\nBuyers include…';
    assert.equal(stripConsensusBuysNarrativeLeadIn(s), s);
  });
});
