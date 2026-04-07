import assert from 'node:assert/strict';
import test from 'node:test';

import { EXPERT_INVESTORS_WATCHLIST } from './expertInvestorsWatchlist.js';
import { DEFAULT_WHALEWISDOM_FILERS } from '../../server/whalewisdom/filerSlugs.js';

test('watchlist Situational Awareness slug matches WhaleWisdom default filers', () => {
  const w = EXPERT_INVESTORS_WATCHLIST.find((e) => e.id === 'situational-awareness-lp');
  assert.ok(w, 'watchlist should include situational-awareness-lp');
  const d = DEFAULT_WHALEWISDOM_FILERS.find((f) => f.slug === 'situational-awareness-lp');
  assert.ok(d, 'default filers should include situational-awareness-lp');
  assert.equal(w.managerName, d.managerName);
  assert.ok(w.whalewisdomUrl.endsWith(`/filer/${w.id}`));
});
