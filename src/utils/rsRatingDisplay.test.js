import assert from 'assert';
import { describe, it } from 'node:test';
import { getIndustryRankBadge, getRsRatingBadge } from './rsRatingDisplay.js';

describe('rsRatingDisplay helpers', () => {
  it('returns muted dash when rating is null', () => {
    assert.deepEqual(getRsRatingBadge(null), {
      label: 'RS: –',
      className: 'text-slate-500',
      title: 'RS Rating not available',
    });
  });

  it('formats high ratings as strongest tone', () => {
    assert.deepEqual(getRsRatingBadge(95), {
      label: 'RS: 95',
      className: 'text-emerald-400',
      title: 'IBD-style RS Rating (1–99)',
    });
  });

  it('formats mid ratings with tiered tones', () => {
    assert.equal(getRsRatingBadge(85).className, 'text-green-400');
    assert.equal(getRsRatingBadge(75).className, 'text-slate-300');
    assert.equal(getRsRatingBadge(60).className, 'text-red-400');
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
});
