/**
 * /api/trades/* HTTP routes (trade journal).
 */

import {
  getAllTrades,
  getTradesByStatus,
  getTradesByTicker,
  getTradeById,
  createTrade,
  updateTrade,
  closeTrade,
  deleteTrade,
  checkAutoExits,
  generateLearningFeedback,
  getTradeStats,
} from '../trades.js';
import { loadLatestScanResultForTicker } from '../db/scanResults.js';
import { applyWeightChanges } from '../opus45Learning.js';
import { parseBooleanQuery } from './query.js';

/**
 * @param {import('express').Application} app
 */
export function registerTradesRoutes(app) {
  app.get('/api/trades', async (req, res) => {
    try {
      const status = req.query.status;
      const ticker = String(req.query.ticker || '').trim();
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
      const includeStats = parseBooleanQuery(req.query.includeStats, true);
      const trades = ticker
        ? await getTradesByTicker(ticker, { status, limit, offset })
        : status
          ? await getTradesByStatus(status)
          : await getAllTrades();
      const payload = { trades, total: trades.length };
      if (includeStats) {
        payload.stats = await getTradeStats();
      }
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trades/stats', async (req, res) => {
    try {
      const stats = await getTradeStats();
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trades/learning', async (req, res) => {
    try {
      const feedback = await generateLearningFeedback();
      res.json(feedback);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trades/:id', async (req, res) => {
    try {
      const trade = await getTradeById(req.params.id);
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      res.json(trade);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/trades', async (req, res) => {
    try {
      const { ticker, entryDate, entryPrice, conviction, notes, companyName, entryMetrics } = req.body;

      if (!ticker || !entryPrice) {
        return res.status(400).json({ error: 'ticker and entryPrice are required' });
      }

      let metrics = entryMetrics || {};

      if (!entryMetrics || Object.keys(entryMetrics).length === 0) {
        try {
          const scanResult = await loadLatestScanResultForTicker(ticker);
          if (scanResult) {
            metrics = {
              sma10: scanResult.sma10 || null,
              sma20: scanResult.sma20 || null,
              sma50: scanResult.sma50 || null,
              sma150: null,
              sma200: null,
              contractions: scanResult.contractions || 0,
              volumeDryUp: scanResult.volumeDryUp || false,
              pattern: scanResult.pattern || 'VCP',
              patternConfidence: scanResult.patternConfidence || null,
              relativeStrength: scanResult.relativeStrength || null,
              pctFromHigh: null,
              pctAboveLow: null,
              high52w: null,
              low52w: null,
              industryName: scanResult.industryName || null,
              industryRank: scanResult.industryRank || null,
              opus45Confidence: scanResult.opus45Confidence || null,
              opus45Grade: scanResult.opus45Grade || null,
              vcpScore: scanResult.score || null,
              enhancedScore: scanResult.enhancedScore || null,
            };
          }
        } catch (e) {
          console.error('Error fetching metrics for trade:', e.message);
        }
      }

      const trade = await createTrade({ ticker, entryDate, entryPrice, conviction, notes, companyName }, metrics);

      res.status(201).json(trade);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/trades/:id', async (req, res) => {
    try {
      const trade = await updateTrade(req.params.id, req.body);
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      res.json(trade);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/trades/:id/close', async (req, res) => {
    try {
      const { exitPrice, exitDate, exitNotes } = req.body;

      if (!exitPrice) {
        return res.status(400).json({ error: 'exitPrice is required' });
      }

      const trade = await closeTrade(req.params.id, exitPrice, exitDate, exitNotes);
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      res.json(trade);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/trades/:id', async (req, res) => {
    try {
      const deleted = await deleteTrade(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/trades/check-exits', async (req, res) => {
    try {
      const results = await checkAutoExits();
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/trades/learning/apply', (req, res) => {
    try {
      const feedback = generateLearningFeedback();

      if (feedback.error) {
        return res.status(400).json(feedback);
      }

      if (feedback.suggestedWeights && Object.keys(feedback.suggestedWeights).length > 0) {
        const newWeights = {};
        for (const [key, data] of Object.entries(feedback.suggestedWeights)) {
          newWeights[key] = data.suggested;
        }

        const result = applyWeightChanges(newWeights);
        res.json({
          feedback,
          applied: true,
          weightsUpdated: result,
        });
      } else {
        res.json({
          feedback,
          applied: false,
          message: 'No weight changes to apply',
        });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
