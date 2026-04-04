import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareCountAbbrev, parseUsdAbbrev } from './parseNumbers.js';
import { classifyActionLine } from './classifyAction.js';
import { parseBestInvestorsFromHtml, filterByMinPerformance } from './parseBestInvestors.js';
import { parsePortfolioPageHtml, parseNextPortfolioPage } from './parsePortfolio.js';
import { dedupeParsedPositionsByTicker, dedupeDbRowsForExpertColumn } from './dedupeExperts.js';

describe('parseNumbers', () => {
  it('parses share abbreviations', () => {
    assert.equal(parseShareCountAbbrev('2.51M'), 2.51e6);
    assert.equal(parseShareCountAbbrev('591k'), 591000);
    assert.equal(parseShareCountAbbrev('47.1k'), 47100);
  });

  it('parses USD abbreviations', () => {
    assert.equal(parseUsdAbbrev('$522M'), 522e6);
    assert.equal(parseUsdAbbrev('$98.4M'), 98.4e6);
  });
});

describe('classifyActionLine', () => {
  it('classifies known phrases', () => {
    assert.deepEqual(classifyActionLine('New holding'), { action_type: 'new_holding', action_pct: null });
    assert.deepEqual(classifyActionLine('Increased shares by 68.8%'), {
      action_type: 'increased',
      action_pct: 68.8,
    });
    assert.deepEqual(classifyActionLine('Sold 21.9% shares'), { action_type: 'sold', action_pct: 21.9 });
  });
});

describe('parseBestInvestorsFromHtml', () => {
  const html = `
  <a class="home-box" href="/portfolio/melvin-capital">
    <h2 class="home-box__title">Gabe Plotkin</h2>
    <h3 class="home-box__subtitle">Melvin Capital</h3>
  </a>
  <a class="home-box" href="/portfolio/mohnish-pabrai">
    <h2 class="home-box__title">Mohnish Pabrai</h2>
    <h3 class="home-box__subtitle">Dalal Street LLC</h3>
    <p class="home-box__performance-label">
      <span class="home-box__performance-label-text">Performance: 85.31% last year</span>
    </p>
  </a>
  <a class="home-box" href="/portfolio/stanley-druckenmiller">
    <h2 class="home-box__title">Stanley Druckenmiller</h2>
    <h3 class="home-box__subtitle">Duquesne</h3>
    <span class="home-box__performance-label-text">Performance: 19.5% last year</span>
  </a>
  `;

  it('extracts slugs, names, and performance', () => {
    const rows = parseBestInvestorsFromHtml(html);
    assert.equal(rows.length, 3);
    const m = rows.find((r) => r.slug === 'mohnish-pabrai');
    assert.ok(m);
    assert.equal(m.performance1yPct, 85.31);
    const mel = rows.find((r) => r.slug === 'melvin-capital');
    assert.equal(mel.performance1yPct, null);
  });

  it('filterByMinPerformance keeps only above threshold', () => {
    const rows = parseBestInvestorsFromHtml(html);
    const f = filterByMinPerformance(rows, 20);
    assert.equal(f.length, 1);
    assert.equal(f[0].slug, 'mohnish-pabrai');
  });
});

describe('parsePortfolioPageHtml', () => {
  const snippet = `
  <div class="js-load-more-btn js-accordion-container" data-next-page="2"></div>
  <div class="share__top-box-link">
    <div class="share__top-box">
      <div class="share share--info">
        <a class="share__company-link" href="/stocks/ntra">
          <h4 class="share__company-name">Natera Inc</h4>
        </a>
      </div>
      <div class="share share--portfolio share--portfolio-big">
        <span class="share__headline">% of Portfolio</span>
        13.2%
      </div>
      <div class="share share--buy-sell">
        <p class="share__muted-text share__muted-text--sell">Q4 2025</p>
        <p class="share__muted-text">Sold 21.9% shares</p>
      </div>
    </div>
  </div>
  <div class="share-details">
    <div class="share__middle-box">
      <div class="share share--detail-info">
        <p class="share__detail-headline">Number of shares</p>
        <p class="share__detail-element">2.51M</p>
      </div>
      <div class="share share--detail-info">
        <p class="share__detail-headline">Holdings current value</p>
        <p class="share__detail-element">$522M</p>
      </div>
    </div>
  </div>

  <div class="share__top-box-link">
    <div class="share__top-box">
      <div class="share share--info">
        <a class="share__company-link" href="/stocks/xlf">
          <h4 class="share__company-name">SSgA Active Trust - Financial Select Sector SPDR</h4>
        </a>
      </div>
      <div class="share share--portfolio share--portfolio-big">
        <span class="share__headline">% of Portfolio</span>
        6.9%
      </div>
      <div class="share share--buy-sell">
        <p class="share__muted-text">Q4 2025</p>
        <p class="share__muted-text">New holding</p>
      </div>
    </div>
  </div>
  <div class="share-details">
    <div class="share share--detail-info">
      <p class="share__detail-headline">Number of shares</p>
      <p class="share__detail-element">5.5M</p>
    </div>
    <div class="share share--detail-info">
      <p class="share__detail-headline">Holdings current value</p>
      <p class="share__detail-element">$272M</p>
    </div>
  </div>
  `;

  it('parses tickers, actions, shares, and value', () => {
    const positions = parsePortfolioPageHtml(snippet);
    assert.equal(positions.length, 2);
    const ntra = positions.find((p) => p.ticker === 'NTRA');
    assert.ok(ntra);
    assert.equal(ntra.actionType, 'sold');
    assert.equal(ntra.actionPct, 21.9);
    assert.equal(ntra.sharesHeld, 2.51e6);
    assert.equal(ntra.positionValueUsd, 522e6);
    assert.equal(ntra.pctOfPortfolio, 13.2);
    const xlf = positions.find((p) => p.ticker === 'XLF');
    assert.equal(xlf.actionType, 'new_holding');
    assert.equal(xlf.positionValueUsd, 272e6);
    assert.equal(xlf.pctOfPortfolio, 6.9);
  });
});

describe('parseNextPortfolioPage', () => {
  it('returns next page number or null', () => {
    assert.equal(parseNextPortfolioPage('<div class="js-load-more-btn" data-next-page="3"></div>'), 3);
    assert.equal(parseNextPortfolioPage('<div class="js-load-more-btn" data-next-page=""></div>'), null);
    assert.equal(parseNextPortfolioPage('<div></div>'), null);
  });
});

describe('dedupeExperts', () => {
  it('dedupeParsedPositionsByTicker keeps better row per ticker', () => {
    const rows = [
      { ticker: 'MSFT', pctOfPortfolio: 1, positionValueUsd: 100 },
      { ticker: 'MSFT', pctOfPortfolio: 2, positionValueUsd: 50 },
    ];
    const u = dedupeParsedPositionsByTicker(rows);
    assert.equal(u.length, 1);
    assert.equal(u[0].pctOfPortfolio, 2);
  });

  it('dedupeDbRowsForExpertColumn skips non buy/sell and dedupes slug', () => {
    const rows = [
      { investor_slug: 'a', action_type: 'increased', pct_of_portfolio: 3 },
      { investor_slug: 'a', action_type: 'increased', pct_of_portfolio: 3 },
      { investor_slug: 'b', action_type: 'unchanged', pct_of_portfolio: 5 },
    ];
    const u = dedupeDbRowsForExpertColumn(rows);
    assert.equal(u.length, 1);
    assert.equal(u[0].investor_slug, 'a');
  });

  it('prefers buy-side action over sell when same slug appears twice', () => {
    const rows = [
      { investor_slug: 'x', action_type: 'sold', pct_of_portfolio: 10 },
      { investor_slug: 'x', action_type: 'increased', pct_of_portfolio: 1 },
    ];
    const u = dedupeDbRowsForExpertColumn(rows);
    assert.equal(u.length, 1);
    assert.equal(u[0].action_type, 'increased');
  });
});
