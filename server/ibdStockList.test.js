import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIbdStockListLine, parseIbdStockListExport } from './ibdStockList.js';

describe('parseIbdStockListLine', () => {
  it('parses NVDA row from IBD export', () => {
    const line =
      'NVDA    NVIDIA                           167.52    -3.72     -2.17%    196,212,600        6%         82.02         60.49         73.21 117.761975308642 73.6081970649895       98      99       42         A         E         B';
    const r = parseIbdStockListLine(line);
    assert.equal(r?.ticker, 'NVDA');
    assert.equal(r?.ibdCompositeRating, 98);
    assert.equal(r?.ibdEpsRating, 99);
    assert.equal(r?.ibdRsRating, 42);
    assert.equal(r?.ibdSmrRating, 'A');
    assert.equal(r?.ibdAccDisRating, 'E');
    assert.equal(r?.ibdGroupRelStrRating, 'B');
  });

  it('parses WMT with letter grades including minus', () => {
    const line =
      'WMT     Walmart                          122.89     0.71      0.58%     16,543,300      -49%         12.12          6.89          5.59 8.09737704918034 10.4913636363636       90      77       87         B         D        A-';
    const r = parseIbdStockListLine(line);
    assert.equal(r?.ticker, 'WMT');
    assert.equal(r?.ibdCompositeRating, 90);
    assert.equal(r?.ibdEpsRating, 77);
    assert.equal(r?.ibdRsRating, 87);
    assert.equal(r?.ibdSmrRating, 'B');
    assert.equal(r?.ibdAccDisRating, 'D');
    assert.equal(r?.ibdGroupRelStrRating, 'A-');
  });

  it('parses PLTR and CORZ with N/A SMR', () => {
    const pltr =
      'PLTR    Palantir Technologies            143.06    -4.50     -3.05%     35,790,800      -31%         78.57           110         70.00 114.760769230769 72.0297333333333       91      99       65         A        B-        D+';
    const a = parseIbdStockListLine(pltr);
    assert.equal(a?.ibdCompositeRating, 91);
    assert.equal(a?.ibdSmrRating, 'A');
    assert.equal(a?.ibdAccDisRating, 'B-');
    assert.equal(a?.ibdGroupRelStrRating, 'D+');

    const corz =
      'CORZ    Core Scientific                   15.07    -0.72     -4.56%      7,915,600      -33%           N/A           N/A        -15.99       -104.53672 107.543181818182       60      67       84       N/A         C        B-';
    const b = parseIbdStockListLine(corz);
    assert.equal(b?.ticker, 'CORZ');
    assert.equal(b?.ibdRsRating, 84);
    assert.equal(b?.ibdSmrRating, null);
    assert.equal(b?.ibdAccDisRating, 'C');
    assert.equal(b?.ibdGroupRelStrRating, 'B-');
  });

  it('returns null for headers and disclaimer', () => {
    assert.equal(parseIbdStockListLine('Stock List Name: My Stock List'), null);
    assert.equal(parseIbdStockListLine('Symbol  Name                           Price'), null);
    assert.equal(
      parseIbdStockListLine("Data provided by William O'Neil + Co., Inc. © 2026."),
      null,
    );
  });
});

describe('parseIbdStockListExport', () => {
  it('parses multi-line export and skips junk', () => {
    const text = `Stock List Name: X
NVDA    NVIDIA                           167.52    -3.5     -2%    1,000        6%         1         2         3 1 1       98      99       73         A         E         B
AAPL    Apple                            248.80    -4.09     -1.62%     47,899,900       -2%         18.33          12.8         15.65 1 1       87      88       68         A        C-         C
`;
    const rows = parseIbdStockListExport(text);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.ticker),
      ['NVDA', 'AAPL'],
    );
  });
});
