/**
 * /api/exit-learning/* HTTP routes.
 */

import { runExitLearning, analyzeCaseStudy, loadExitLearningHistory } from '../exitLearning.js';
import { runHistoricalExitLearning } from '../historicalExitAnalysis.js';

/**
 * @param {import('express').Application} app
 */
export function registerExitLearningRoutes(app) {
  app.post('/api/exit-learning/run', async (req, res) => {
    try {
      const includeBehaviorAnalysis = req.query.includeBehaviorAnalysis === 'true';

      console.log('\n🧠 Starting Exit Learning Analysis...');
      const analysis = await runExitLearning({ includeBehaviorAnalysis });

      if (analysis.error) {
        return res.status(400).json(analysis);
      }

      res.json(analysis);
    } catch (e) {
      console.error('Exit learning error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/exit-learning/history', (req, res) => {
    try {
      const history = loadExitLearningHistory();
      res.json({ history, count: history.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/exit-learning/case-study', async (req, res) => {
    try {
      const { ticker, entryDate } = req.body;

      if (!ticker || !entryDate) {
        return res.status(400).json({
          error: 'ticker and entryDate are required',
          example: { ticker: 'CMC', entryDate: '2026-02-17' },
        });
      }

      console.log(`\n🔍 Analyzing case study: ${ticker} @ ${entryDate}`);
      const analysis = await analyzeCaseStudy(ticker, entryDate);

      if (analysis.error) {
        return res.status(400).json(analysis);
      }

      res.json(analysis);
    } catch (e) {
      console.error('Case study error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/exit-learning/historical', async (req, res) => {
    try {
      const maxSignals = parseInt(req.query.maxSignals) || 50;
      const daysToTrack = parseInt(req.query.daysToTrack) || 30;
      const fromDate = req.query.fromDate || null;
      const includeTradeDetails = req.query.includeTradeDetails === 'true';

      console.log('\n🧠 Starting Historical Exit Learning...');
      console.log(`  Max signals: ${maxSignals}`);
      console.log(`  Days to track: ${daysToTrack}`);
      if (fromDate) console.log(`  From date: ${fromDate}`);

      const analysis = await runHistoricalExitLearning({
        maxSignals,
        daysToTrack,
        fromDate,
        includeTradeDetails,
        saveReport: true,
      });

      if (analysis.error) {
        return res.status(400).json(analysis);
      }

      res.json(analysis);
    } catch (e) {
      console.error('Historical exit learning error:', e);
      res.status(500).json({ error: e.message });
    }
  });
}
