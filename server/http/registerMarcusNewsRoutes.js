/**
 * /api/marcus/* and /api/news/* HTTP routes.
 */

/**
 * @param {import('express').Application} app
 */
export function registerMarcusNewsRoutes(app) {
  app.get('/api/marcus/summary', async (req, res) => {
    try {
      const includeNews = String(req.query.includeNews ?? '1') !== '0';
      const newsLimitRaw = Number(req.query.newsLimit ?? 8);
      const newsLimit = Number.isFinite(newsLimitRaw) ? Math.max(0, Math.min(20, newsLimitRaw)) : 8;

      const { getMarcusSummary } = await import('../agents/marcus.js');
      const summary = await getMarcusSummary({ includeNews, newsLimit });
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/news/search', async (req, res) => {
    try {
      const ticker = String(req.query.ticker ?? '').trim();
      const date = String(req.query.date ?? '').trim();
      if (!ticker) return res.status(400).json({ error: 'Missing ticker query param.' });
      if (!date) return res.status(400).json({ error: 'Missing date query param (YYYY-MM-DD).' });

      const limitRaw = Number(req.query.limit ?? 8);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, limitRaw)) : 8;

      const { fetchYahooTickerNews } = await import('../news/newsSearch.js');
      const items = await fetchYahooTickerNews({ ticker, date, limit });
      res.json({ ticker, date, items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/marcus/orchestrate', async (req, res) => {
    const { tickerLimit = 200, forceRefresh = false } = req.body || {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    };

    try {
      send({ phase: 'starting', message: 'Marcus: starting orchestration...' });
      const { runMarcusOrchestration } = await import('../agents/marcus.js');
      const result = await runMarcusOrchestration({
        tickerLimit,
        forceRefresh,
        onProgress: (p) => send(p),
      });
      send({ done: true, result });
      res.end();
    } catch (e) {
      console.error('Marcus orchestration error:', e);
      send({ done: true, error: e.message });
      res.end();
    }
  });
}
