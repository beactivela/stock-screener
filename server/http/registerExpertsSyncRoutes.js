/**
 * Combined experts sync cron: FMP (Congress + 13F probe) + StockCircle + WhaleWisdom in one POST.
 */
import { validateCronSecret } from './cronSecretAuth.js';
import { runExpertsSync } from '../experts/runExpertsSync.js';

let expertsJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

/** True when UI may trigger sync without Bearer in production. Unset = strict; docker-compose sets =1. */
function expertsSyncAllowUnauthenticatedBrowser() {
  const v = String(process.env.CRON_ALLOW_EXPERTS_BROWSER_SYNC ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return v === '1' || v === 'true' || v === 'yes';
}

export function registerExpertsSyncRoutes(app) {
  app.post('/api/cron/experts-sync', async (req, res) => {
    if (
      !validateCronSecret(req, res, {
        allowMissingSecret: expertsSyncAllowUnauthenticatedBrowser(),
      })
    ) {
      return;
    }
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
      message:
        'Experts sync started (FMP Congress → StockCircle → WhaleWisdom; 13F institutional fetch when your FMP plan allows)',
    });
  });
}
