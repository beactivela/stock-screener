/**
 * /api/regime/* HTTP routes (HMM regime, Harry analytics, regime bars).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { loadCurrentRegime, loadRegimeBacktest } from '../regimeHmm.js';
import { fetchTradingViewIndustryReturns } from '../tradingViewIndustry.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * @param {import('express').Application} app
 */
export function registerRegimeRoutes(app) {
  app.get('/api/regime', async (req, res) => {
    try {
      const data = await loadCurrentRegime();
      if (!data.spy && !data.qqq) {
        return res.status(404).json({ error: 'Regime not trained. Run: npm run fetch-regime-data && npm run regime:train' });
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/regime/backtest', async (req, res) => {
    try {
      const data = await loadRegimeBacktest();
      if (!data.spy && !data.qqq) {
        return res.status(404).json({ error: 'Regime backtest not found. Run: npm run regime:train' });
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/regime/harry', async (req, res) => {
    const normalizeRegime = (value) => {
      const v = String(value || '').toUpperCase();
      if (v === 'BULL' || v === 'UNCERTAIN' || v === 'CORRECTION' || v === 'BEAR') return v;
      return 'UNCERTAIN';
    };

    const fallbackStageHistory = (backtestData) => {
      const base = backtestData?.spy?.fullHistory || backtestData?.qqq?.fullHistory || [];
      return base.map((item) => ({
        date: item.date,
        regime: item.regime === 'bull' ? 'BULL' : 'BEAR',
        source: 'hmm_fallback',
      }));
    };

    try {
      const [
        { listBatchRuns },
        {
          buildRegimeLeaderboard,
          buildRegimeProfile,
          buildTopDownFilterProfile,
          buildSectorRankByTicker,
          buildSectorRsPercentileByTicker,
        },
        { getHistoricalMarketConditions },
      ] = await Promise.all([
        import('../learning/batchCheckpointStore.js'),
        import('../agents/harryHistorian.js'),
        import('../learning/distributionDays.js'),
      ]);

      const runs = await listBatchRuns(1);
      const latestRun = runs?.[0] || null;
      const cycles = latestRun?.finalResult?.cycles || [];
      const leaderboardByRegime = latestRun?.finalResult?.leaderboardByRegime || buildRegimeLeaderboard(cycles);
      const profileByRegime = buildRegimeProfile(cycles);
      const topDownProfileByRegime = {
        BULL: buildTopDownFilterProfile('BULL'),
        UNCERTAIN: buildTopDownFilterProfile('UNCERTAIN'),
        CORRECTION: buildTopDownFilterProfile('CORRECTION'),
        BEAR: buildTopDownFilterProfile('BEAR'),
      };

      const backtestData = await loadRegimeBacktest();
      const allDates = [
        ...(backtestData?.spy?.fullHistory || []).map((r) => r.date),
        ...(backtestData?.qqq?.fullHistory || []).map((r) => r.date),
      ].filter(Boolean);
      const sortedDates = [...new Set(allDates)].sort();
      const fromDate = sortedDates[0] || null;
      const toDate = sortedDates[sortedDates.length - 1] || null;

      let stageHistory = [];
      let stageHistorySource = 'none';
      if (fromDate && toDate) {
        try {
          const historical = await getHistoricalMarketConditions(fromDate, toDate);
          stageHistory = (historical || []).map((row) => ({
            date: row.date,
            regime: normalizeRegime(row.market_regime || row.regime),
            source: 'market_conditions',
          }));
          stageHistorySource = stageHistory.length > 0 ? 'market_conditions' : 'hmm_fallback';
        } catch {
          stageHistory = [];
        }
      }
      if (stageHistory.length === 0) {
        stageHistory = fallbackStageHistory(backtestData);
        stageHistorySource = stageHistory.length > 0 ? 'hmm_fallback' : 'none';
      }

      const tvPayload = await fetchTradingViewIndustryReturns({ useCache: true });
      const sectorRankByTicker = buildSectorRankByTicker(tvPayload);
      const sectorRsPercentileByTicker = buildSectorRsPercentileByTicker(tvPayload);
      const tickerRows = Object.keys(sectorRsPercentileByTicker).map((ticker) => ({
        ticker,
        industry: tvPayload?.tickerToTvIndustry?.get?.(ticker) || null,
        sectorRankPct: sectorRankByTicker[ticker] ?? null,
        sectorRsPercentile: sectorRsPercentileByTicker[ticker] ?? null,
      }));

      tickerRows.sort((a, b) => {
        const p = (b.sectorRsPercentile ?? -Infinity) - (a.sectorRsPercentile ?? -Infinity);
        if (p !== 0) return p;
        const r = (a.sectorRankPct ?? Infinity) - (b.sectorRankPct ?? Infinity);
        if (r !== 0) return r;
        return a.ticker.localeCompare(b.ticker);
      });

      res.json({
        latestBatchRun: latestRun
          ? {
              runId: latestRun.runId,
              status: latestRun.status,
              updatedAt: latestRun.updatedAt,
              cyclesCompleted: latestRun.finalResult?.cyclesCompleted ?? 0,
              cyclesPlanned: latestRun.finalResult?.cyclesPlanned ?? 0,
            }
          : null,
        leaderboardByRegime,
        profileByRegime,
        topDownProfileByRegime,
        stageHistorySource,
        stageHistory,
        sectorRsRankings: tickerRows.slice(0, 250),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/regime/bars/:ticker', async (req, res) => {
    try {
      const ticker = (req.params.ticker || '').toUpperCase();
      if (ticker !== 'SPY' && ticker !== 'QQQ') {
        return res.status(400).json({ error: 'Ticker must be SPY or QQQ' });
      }
      if (isSupabaseConfigured()) {
        const supabase = getSupabase();
        const { data, error } = await supabase.from('regime_bars').select('results').eq('ticker', ticker).single();
        if (error || !data) return res.status(404).json({ error: '5y data not found. Run: npm run fetch-regime-data' });
        return res.json({ ticker, results: data.results || [] });
      }
      const filePath = path.join(DATA_DIR, 'regime', `${ticker.toLowerCase()}_5y.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '5y data not found. Run: npm run fetch-regime-data' });
      }
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.json({ ticker, results: raw.results || [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
