import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractTaggedInsight,
  stripExpertOverlapInstructionEcho,
  finalizeExpertOverlapInsightText,
} from './expertOverlapInsightText.js';

describe('extractTaggedInsight', () => {
  it('returns inner text for <insight> tags', () => {
    assert.strictEqual(
      extractTaggedInsight('Preamble <insight>\nOaktree trimmed INDV.\n</insight> tail'),
      'Oaktree trimmed INDV.'
    );
  });

  it('is case-insensitive on tag names', () => {
    assert.strictEqual(extractTaggedInsight('<INSIGHT>Hello.</INSIGHT>'), 'Hello.');
  });

  it('returns null when tags are missing', () => {
    assert.strictEqual(extractTaggedInsight('No tags here.'), null);
  });
});

describe('stripExpertOverlapInstructionEcho', () => {
  it('removes leading "The user wants" and numbered rubric lines', () => {
    const raw = [
      'The user wants a summary of institutional-style stock overlap data.',
      'The key requirements are: 1. Output 2-5 sentences',
      '',
      'Oaktree Capital trimmed INDV by roughly $7.5B.',
    ].join('\n');
    assert.strictEqual(
      stripExpertOverlapInstructionEcho(raw),
      'Oaktree Capital trimmed INDV by roughly $7.5B.'
    );
  });

  it('drops markdown section headers used as scratchpad', () => {
    const raw = [
      '### Requirements',
      '1. Output plain English',
      '',
      'Fisher added IEF.',
    ].join('\n');
    assert.strictEqual(stripExpertOverlapInstructionEcho(raw), 'Fisher added IEF.');
  });
});

describe('finalizeExpertOverlapInsightText', () => {
  it('prefers tagged content over surrounding noise', () => {
    const raw =
      'The user wants… <insight>Only this.</insight> trailing junk';
    assert.strictEqual(finalizeExpertOverlapInsightText(raw), 'Only this.');
  });

  it('falls back to strip when no tags', () => {
    const raw = 'The user wants X.\n\nReal sentence about $ moves.';
    assert.strictEqual(finalizeExpertOverlapInsightText(raw), 'Real sentence about $ moves.');
  });
});
