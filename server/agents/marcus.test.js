/**
 * Unit tests for Marcus (CEO money manager) summary logic.
 * Run: node --test server/agents/marcus.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  deriveMarketOutlook,
  deriveAggressiveness,
  assessSubagentHealth,
} from './marcus.js';
import { parseRssXml } from '../news/marketNews.js';

describe('deriveMarketOutlook', () => {
  it('maps BULL + low distribution days to Confirmed Uptrend', () => {
    const outlook = deriveMarketOutlook({
      regime: 'BULL',
      confidence: 78,
      distributionDays: 2,
      raw: { spyAbove50ma: true, qqqAbove50ma: true, isFollowThroughDay: false },
    });
    assert.equal(outlook.trendLabel, 'Confirmed Uptrend');
    assert.equal(outlook.regime, 'BULL');
  });

  it('maps UNCERTAIN to Uptrend Under Pressure', () => {
    const outlook = deriveMarketOutlook({
      regime: 'UNCERTAIN',
      confidence: 55,
      distributionDays: 4,
      raw: { spyAbove50ma: true, qqqAbove50ma: false, isFollowThroughDay: false },
    });
    assert.equal(outlook.trendLabel, 'Uptrend Under Pressure');
  });

  it('maps CORRECTION to Market in Correction', () => {
    const outlook = deriveMarketOutlook({
      regime: 'CORRECTION',
      confidence: 66,
      distributionDays: 6,
      raw: { spyAbove50ma: false, qqqAbove50ma: false, isFollowThroughDay: false },
    });
    assert.equal(outlook.trendLabel, 'Market in Correction');
  });

  it('maps BEAR to Market in Downtrend', () => {
    const outlook = deriveMarketOutlook({
      regime: 'BEAR',
      confidence: 80,
      distributionDays: 7,
      raw: { spyAbove50ma: false, qqqAbove50ma: false, isFollowThroughDay: false },
    });
    assert.equal(outlook.trendLabel, 'Market in Downtrend');
  });
});

describe('deriveAggressiveness', () => {
  it('recommends Cash when exposure is 0', () => {
    const a = deriveAggressiveness({ exposureMultiplier: 0, maxPositions: 0 });
    assert.equal(a.label, 'Cash');
    assert.equal(a.recommendedExposurePct, 0);
  });

  it('recommends Aggressive when exposure is high', () => {
    const a = deriveAggressiveness({ exposureMultiplier: 1, maxPositions: 50 });
    assert.equal(a.label, 'Aggressive');
    assert.equal(a.recommendedExposurePct, 100);
  });
});

describe('assessSubagentHealth', () => {
  it('marks a failed agent as fail with improvement text', () => {
    const h = assessSubagentHealth({
      agentType: 'momentum_scout',
      name: 'Momentum Scout',
      success: false,
      reason: 'Insufficient signals (3 < 10 minimum)',
      signalCount: 3,
    });
    assert.equal(h.status, 'fail');
    assert.ok(h.improvements.some((x) => x.toLowerCase().includes('insufficient')));
    assert.equal(h.confidencePct, 0);
  });

  it('gives higher confidence when evidence is strong and WFO is used', () => {
    const h = assessSubagentHealth({
      agentType: 'base_hunter',
      name: 'Base Hunter',
      success: true,
      signalCount: 120,
      wfo: { usingWFO: true, testSignals: 25 },
      bayesian: { evidence: 'strong', bayesFactor: 12.3, testDelta: 1.2 },
      abComparison: { promoted: true },
    });
    assert.equal(h.status, 'ok');
    assert.ok(h.confidencePct >= 70);
  });
});

describe('parseRssXml', () => {
  it('parses RSS items and returns normalized fields', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Example</title>
          <item>
            <title>Markets rally on soft CPI</title>
            <link>https://example.com/a</link>
            <pubDate>Sat, 21 Feb 2026 10:00:00 GMT</pubDate>
            <description><![CDATA[<p>Stocks rise...</p>]]></description>
          </item>
          <item>
            <title>Fed minutes preview</title>
            <link>https://example.com/b</link>
            <pubDate>Sat, 21 Feb 2026 09:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    const items = parseRssXml(xml);
    assert.equal(items.length, 2);
    assert.deepEqual(Object.keys(items[0]).sort(), ['publishedAt', 'source', 'title', 'url'].sort());
    assert.equal(items[0].url, 'https://example.com/a');
  });
});

