import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_WHALEWISDOM_FILERS, getWhalewisdomFilersFromEnv } from './filerSlugs.js';

test('DEFAULT_WHALEWISDOM_FILERS includes Situational Awareness / Leopold Aschenbrenner', () => {
  const sa = DEFAULT_WHALEWISDOM_FILERS.find((f) => f.slug === 'situational-awareness-lp');
  assert.ok(sa, 'expected situational-awareness-lp in default filer list');
  assert.equal(sa.managerName, 'Leopold Aschenbrenner');
});

test('getWhalewisdomFilersFromEnv respects WHALEWISDOM_FILER_SLUGS', () => {
  const prev = process.env.WHALEWISDOM_FILER_SLUGS;
  try {
    process.env.WHALEWISDOM_FILER_SLUGS = 'alpha-fund,bravo-lp';
    const list = getWhalewisdomFilersFromEnv();
    assert.equal(list.length, 2);
    assert.equal(list[0].slug, 'alpha-fund');
    assert.equal(list[1].slug, 'bravo-lp');
  } finally {
    if (prev === undefined) delete process.env.WHALEWISDOM_FILER_SLUGS;
    else process.env.WHALEWISDOM_FILER_SLUGS = prev;
  }
});
