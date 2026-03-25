/**
 * Compare deployed GIT_COMMIT vs GitHub default branch (public API) and optionally
 * trigger a GitHub Actions workflow to rebuild + push GHCR (Watchtower pulls on the VPS).
 */

import { getCronSecret } from './cronConfig.js';

const REMOTE_SHA_CACHE_MS = 120_000;
let remoteShaCache = { at: 0, sha: null, branch: null, error: null };

export function parseGithubRepo(repoEnv) {
  if (!repoEnv || typeof repoEnv !== 'string') return null;
  const t = repoEnv.trim();
  const parts = t.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
}

export function normalizeDeployedSha(sha) {
  if (!sha || typeof sha !== 'string') return '';
  const s = sha.trim();
  if (s.length > 12) return s.slice(0, 8);
  return s;
}

function getDeployAuthSecret() {
  const d = process.env.DEPLOY_SECRET?.trim();
  if (d) return d;
  return getCronSecret() || null;
}

function verifyDeployAuth(req) {
  const want = getDeployAuthSecret();
  if (!want) return false;
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const header = String(req.headers['x-deploy-secret'] || bearer || '').trim();
  return header === want;
}

async function fetchRemoteHeadSha(owner, repo, branch, githubToken) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stock-screener-deploy-status',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const sha = data?.sha;
  if (!sha || typeof sha !== 'string') throw new Error('No sha in GitHub response');
  return sha.slice(0, 8);
}

/**
 * @param {import('express').Application} app
 */
export function registerDeployRoutes(app) {
  app.get('/api/deploy/status', async (req, res) => {
    try {
      const repo = parseGithubRepo(process.env.GITHUB_REPO);
      const branch = process.env.GITHUB_DEFAULT_BRANCH?.trim() || 'main';
      const deployedFull = process.env.GIT_COMMIT?.trim() || '';
      const deployed = normalizeDeployedSha(deployedFull);
      const token = process.env.GITHUB_TOKEN?.trim() || null;
      const dispatchConfigured = !!(token && repo);

      if (!repo) {
        return res.json({
          deployedSha: deployed,
          remoteSha: null,
          branch,
          updateAvailable: false,
          dispatchConfigured: false,
          repo: null,
          message: 'Set GITHUB_REPO=owner/repo on the server to enable update checks.',
        });
      }

      const now = Date.now();
      let remoteSha = remoteShaCache.sha;
      if (
        !remoteShaCache.sha ||
        now - remoteShaCache.at > REMOTE_SHA_CACHE_MS ||
        remoteShaCache.branch !== branch
      ) {
        try {
          remoteSha = await fetchRemoteHeadSha(repo.owner, repo.repo, branch, token);
          remoteShaCache = { at: now, sha: remoteSha, branch, error: null };
        } catch (e) {
          remoteShaCache = { at: now, sha: null, branch, error: e.message };
          return res.status(502).json({
            deployedSha: deployed,
            remoteSha: null,
            branch,
            updateAvailable: false,
            dispatchConfigured,
            repo: `${repo.owner}/${repo.repo}`,
            error: e.message,
          });
        }
      }

      const updateAvailable =
        !!remoteSha && (!deployed || remoteSha.toLowerCase() !== deployed.toLowerCase());

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        deployedSha: deployed || null,
        remoteSha,
        branch,
        updateAvailable,
        dispatchConfigured,
        repo: `${repo.owner}/${repo.repo}`,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/deploy/trigger', async (req, res) => {
    if (process.env.NODE_ENV === 'production' && !getDeployAuthSecret()) {
      return res.status(503).json({
        error: 'Set DEPLOY_SECRET or CRON_SECRET on the server before using deploy trigger.',
      });
    }

    const repo = parseGithubRepo(process.env.GITHUB_REPO);
    const token = process.env.GITHUB_TOKEN?.trim();
    const branch = process.env.GITHUB_DEFAULT_BRANCH?.trim() || 'main';

    if (!repo || !token) {
      return res.status(503).json({
        error: 'Server is not configured for deploy trigger.',
        hint: 'Set GITHUB_REPO and GITHUB_TOKEN (PAT with actions:write) on the VPS.',
      });
    }

    if (!verifyDeployAuth(req)) {
      return res.status(401).json({ error: 'Invalid or missing deploy secret (Bearer token or x-deploy-secret).' });
    }

    const workflowFile = process.env.GITHUB_WORKFLOW_FILE?.trim() || 'docker-publish.yml';
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;

    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'stock-screener-deploy-trigger',
      },
      body: JSON.stringify({ ref: branch }),
    });

    if (!ghRes.ok) {
      const body = await ghRes.text();
      return res.status(502).json({
        error: `GitHub Actions dispatch failed (${ghRes.status})`,
        detail: body.slice(0, 500),
      });
    }

    remoteShaCache = { at: 0, sha: null, branch: null, error: null };
    res.json({
      ok: true,
      message:
        'Build workflow started. After GHCR publishes a new image, Watchtower (or docker compose pull) will roll the container.',
    });
  });
}
