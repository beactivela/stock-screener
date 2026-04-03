import assert from 'assert';
import { describe, it } from 'node:test';
import {
  getIbdGroupRelStrBadge,
  getIbdRsRatingBadge,
  getIndustryRankBadge,
  getScanRsRatingBadge,
} from './rsRatingDisplay.js';

describe('rsRatingDisplay helpers', () => {
  it('Scan RS: muted when null', () => {
    assert.deepEqual(getScanRsRatingBadge(null), {
      label: 'Scan RS: –',
      className: 'text-slate-500',
      title:
        'Relative strength (1–99) from this app’s latest scan (same idea as the dashboard RS column). Ticker may be missing from that snapshot.',
    });
  });

  it('Scan RS: formats value', () => {
    const b = getScanRsRatingBadge(95);
    assert.equal(b.label, 'Scan RS: 95');
    assert.equal(b.className, 'text-emerald-400');
    assert.ok(b.title.includes('latest scan'));
  });

  it('IBD RS: muted when null', () => {
    assert.equal(getIbdRsRatingBadge(null).label, 'IBD RS: –');
    assert.ok(getIbdRsRatingBadge(88).title.includes('list import'));
  });

  it('tier colors match for both RS sources', () => {
    assert.equal(getScanRsRatingBadge(85).className, 'text-green-400');
    assert.equal(getIbdRsRatingBadge(85).className, 'text-green-400');
    assert.equal(getScanRsRatingBadge(60).className, 'text-red-400');
  });

  it('returns muted dash when industry rank is null', () => {
    assert.deepEqual(getIndustryRankBadge(null), {
      label: 'Ind: –',
      className: 'text-slate-500',
      title: 'Industry Rank not available',
    });
  });

  it('formats industry rank with tiered tones', () => {
    assert.equal(getIndustryRankBadge(12).className, 'text-emerald-400');
    assert.equal(getIndustryRankBadge(35).className, 'text-green-400');
    assert.equal(getIndustryRankBadge(70).className, 'text-slate-300');
    assert.equal(getIndustryRankBadge(95).className, 'text-red-400');
  });

  it('formats IBD Group Rel Str letter grade', () => {
    const b = getIbdGroupRelStrBadge('A-');
    assert.equal(b.label, 'Ind: A-');
    assert.equal(b.className, 'text-emerald-400');
    assert.equal(getIbdGroupRelStrBadge(null).label, 'Ind: –');
  });
});
