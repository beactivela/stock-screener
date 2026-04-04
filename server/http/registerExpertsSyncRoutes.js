/**
 * Combined experts sync cron: StockCircle + WhaleWisdom in one POST.
 */
import { validateCronSecret } from './cronSecretAuth.js';
import { runExpertsSync } from '../experts/runExpertsSync.js';

let expertsJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

export function registerExpertsSyncRoutes(app) {
  app.post('/api/cron/experts-sync', async (req, res) => {
    if (!validateCronSecret(req, res)) return;
    if (expertsJob.running) {
      return res.status(202).json({ ok: true, message: 'Experts sync already in progress' });
    }

    expertsJob.running = true;
    expertsJob.lastStartedAt = new Date().toISOString();
    expertsJob.lastResult = null;

    (async () => {
      try {
        const result = await runExpertsSync();
        expertsJob.lastResult = result;
        console.log('Experts sync finished:', result);
      } catch (e) {
        console.error('Experts sync failed:', e);
        expertsJob.lastResult = { ok: false, error: e.message };
      } finally {
        expertsJob.running = false;
        expertsJob.lastFinishedAt = new Date().toISOString();
      }
    })();

    res.status(202).json({
      ok: true,
      started: true,
      message: 'Experts sync started (StockCircle, then WhaleWisdom)',
    });
  });
}
