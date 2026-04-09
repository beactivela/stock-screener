/**
 * Express server: API + frontend (Vite in dev, static dist in prod). Caches API data to flat JSON files.
 * Loads .env from project root. Ticker list + industry from TradingView; OHLC bars from Yahoo (TradingView has no bar API).
 * Dev: npm run dev → one process on 5174 (API + Vite HMR). Prod: npm run serve (build + serve on PORT).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (parent of server/) — cron + all other env vars
const ROOT_ENV = path.join(__dirname, '..', '.env');
dotenv.config({ path: ROOT_ENV });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { registerDeployRoutes } from './deployRemote.js';
import {
  registerHealthRoute,
  registerCoreScanCronBarsMarketRoutes,
} from './http/registerCoreScanCronBarsMarketRoutes.js';
import { registerLearningRoutes } from './http/registerLearningRoutes.js';
import { registerOpus45Routes } from './http/registerOpus45Routes.js';
import { registerTradesRoutes } from './http/registerTradesRoutes.js';
import { registerExitLearningRoutes } from './http/registerExitLearningRoutes.js';
import {
  registerAgentsRoutesBeforeHeartbeat,
  registerAgentsRoutesAfterHeartbeat,
} from './http/registerAgentsRoutes.js';
import { registerMarcusNewsRoutes } from './http/registerMarcusNewsRoutes.js';
import { registerTradingAgentsRoutes } from './http/registerTradingAgentsRoutes.js';
import { registerAiPortfolioRoutes } from './http/registerAiPortfolioRoutes.js';
import { registerStockcircleRoutes } from './http/registerStockcircleRoutes.js';
import { registerWhalewisdomRoutes } from './http/registerWhalewisdomRoutes.js';
import { registerExpertsSyncRoutes } from './http/registerExpertsSyncRoutes.js';
import { registerExpertsSummaryRoutes } from './http/registerExpertsSummaryRoutes.js';
import { registerExpertsInsightsRoutes } from './http/registerExpertsInsightsRoutes.js';
import { registerAiHedgeFundFmpRoutes } from './http/registerAiHedgeFundFmpRoutes.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');

app.use(cors());
app.use(express.json());

registerHealthRoute(app);
registerAiHedgeFundFmpRoutes(app);

registerDeployRoutes(app);

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}

ensureDirs();

registerCoreScanCronBarsMarketRoutes(app);
registerStockcircleRoutes(app);
registerWhalewisdomRoutes(app);
registerExpertsSyncRoutes(app);
registerExpertsSummaryRoutes(app);
registerExpertsInsightsRoutes(app);
registerLearningRoutes(app);

// Optional: run full scan every 24 hours
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
function scheduleDailyScan() {
  setInterval(async () => {
    console.log('Running scheduled 24h VCP scan...');
    const { runScan } = await import('./scan.js');
    runScan().catch((e) => console.error('Scheduled scan failed:', e));
  }, TWENTY_FOUR_HOURS_MS);
}
if (process.env.SCHEDULE_SCAN === '1') {
  scheduleDailyScan();
  console.log('24h scan scheduler enabled (SCHEDULE_SCAN=1).');
}

registerOpus45Routes(app);
registerTradesRoutes(app);
registerExitLearningRoutes(app);
registerTradingAgentsRoutes(app);
const aiPortfolioService = registerAiPortfolioRoutes(app);
registerAgentsRoutesBeforeHeartbeat(app);
registerMarcusNewsRoutes(app);

// ─── Heartbeat cron (5 min): in-server scheduler, user can turn on/off ────────
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const heartbeatState = {
  enabled: false,
  timerId: null,
  running: false,
  lastRun: null,      // ISO string
  lastResult: null,   // { regime, signalCount, elapsedMs, ... }
  nextRun: null,      // ISO string (when next tick will fire)
};

async function runHeartbeatTick() {
  if (heartbeatState.running) {
    console.log('[Heartbeat] Previous run still in progress — skipping tick.');
    return;
  }
  heartbeatState.running = true;
  heartbeatState.lastRun = new Date().toISOString();
  try {
    const { runMarcusOrchestration } = await import('./agents/marcus.js');
    const result = await runMarcusOrchestration({
      tickerLimit: 200,
      forceRefresh: false,
      onProgress: () => {},
    });
    heartbeatState.lastResult = {
      regime: result.regime,
      signalCount: result.signalCount,
      approvedCount: result.approvedCount,
      elapsedMs: result.elapsedMs,
    };
    console.log(`[Heartbeat] Tick complete — regime=${result.regime} signals=${result.signalCount} elapsed=${result.elapsedMs}ms`);
  } catch (e) {
    console.error('[Heartbeat] Tick error:', e);
    heartbeatState.lastResult = { error: e.message };
  } finally {
    heartbeatState.running = false;
  }
}

function startHeartbeatCron() {
  if (heartbeatState.timerId) return;
  heartbeatState.enabled = true;
  const scheduleNext = () => {
    heartbeatState.nextRun = new Date(Date.now() + HEARTBEAT_INTERVAL_MS).toISOString();
    runHeartbeatTick().catch(() => {});
  };
  heartbeatState.timerId = setInterval(scheduleNext, HEARTBEAT_INTERVAL_MS);
  heartbeatState.nextRun = new Date(Date.now() + HEARTBEAT_INTERVAL_MS).toISOString();
  // Run first tick immediately so user sees activity when they turn cron on
  runHeartbeatTick().catch(() => {});
  console.log('[Heartbeat] Cron started — fires every 5 minutes (first tick running now).');
}

function stopHeartbeatCron() {
  if (heartbeatState.timerId) {
    clearInterval(heartbeatState.timerId);
    heartbeatState.timerId = null;
  }
  heartbeatState.enabled = false;
  heartbeatState.nextRun = null;
  console.log('[Heartbeat] Cron stopped.');
}

app.get('/api/heartbeat', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30');
    res.json({
      enabled: heartbeatState.enabled,
      status: heartbeatState.running ? 'running' : 'idle',
      lastRun: heartbeatState.lastRun ?? null,
      lastResult: heartbeatState.lastResult ?? null,
      nextRun: heartbeatState.nextRun ?? null,
    });
  } catch (e) {
    console.error('[Heartbeat] GET error:', e);
    res.status(500).json({ error: String(e.message), enabled: false, status: 'idle', lastRun: null, lastResult: null, nextRun: null });
  }
});

app.post('/api/heartbeat/start', (req, res) => {
  try {
    startHeartbeatCron();
    res.json({ ok: true, enabled: true, message: 'Heartbeat cron started (every 5 min).' });
  } catch (e) {
    console.error('[Heartbeat] start error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/heartbeat/stop', (req, res) => {
  try {
    stopHeartbeatCron();
    res.json({ ok: true, enabled: false, message: 'Heartbeat cron stopped.' });
  } catch (e) {
    console.error('[Heartbeat] stop error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/ai-portfolio/scheduler/start', (req, res) => {
  try {
    aiPortfolioService.startScheduler();
    res.json({ ok: true, enabled: true, message: 'AI Portfolio scheduler started.' });
  } catch (e) {
    console.error('[AI Portfolio] start scheduler error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/ai-portfolio/scheduler/stop', (req, res) => {
  try {
    aiPortfolioService.stopScheduler();
    res.json({ ok: true, enabled: false, message: 'AI Portfolio scheduler stopped.' });
  } catch (e) {
    console.error('[AI Portfolio] stop scheduler error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

registerAgentsRoutesAfterHeartbeat(app);

// --- Frontend: Vite dev middleware (dev) or static dist (production) ---
const DIST_DIR = path.join(__dirname, '..', 'dist');
const isDev = process.env.NODE_ENV === 'development';

async function attachFrontend() {
  if (isDev) {
    // Single process: Express serves /api, Vite serves app + HMR on same port
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        watch: {
          // Avoid full-page reload loops when backend jobs update cached data files.
          ignored: ['**/data/**'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Dev: Vite middleware attached (HMR on same port)');
  } else if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
    console.log('Serving static app from dist/');
  }
  app.listen(PORT, () => {
    console.log(`Stock screener at http://localhost:${PORT}`);
  });
}

// Tests set SKIP_EXPRESS_LISTEN=1 so they can mount `app` on an ephemeral port without double listen / static attach.
if (process.env.SKIP_EXPRESS_LISTEN !== '1') {
  attachFrontend();
}

export { app };
