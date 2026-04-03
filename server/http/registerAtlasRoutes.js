import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  downsampleTrajectoryForSparkline,
  parsePortfolioTrajectoryCsv,
} from '../atlasPortfolioTrajectory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const atlasRoot = path.join(__dirname, '..', '..', 'vendor', 'atlas-gic')
const atlasSummaryPath = path.join(atlasRoot, 'results', 'summary.json')
const atlasTrajectoryPath = path.join(atlasRoot, 'results', 'portfolio_trajectory.csv')
const atlasRepoUrl = 'https://github.com/chrisworsey55/atlas-gic'

const REL_SUMMARY = 'vendor/atlas-gic/results/summary.json'
const REL_TRAJECTORY = 'vendor/atlas-gic/results/portfolio_trajectory.csv'

function loadAtlasSummaryFromDisk() {
  const raw = fs.readFileSync(atlasSummaryPath, 'utf8')
  return JSON.parse(raw)
}

/**
 * @param {string} relativePath
 * @param {string} absolutePath
 * @returns {{ path: string, mtimeMs: number, mtimeIso: string } | { path: string, error: string }}
 */
function statFreshness(relativePath, absolutePath) {
  try {
    const st = fs.statSync(absolutePath)
    return {
      path: relativePath,
      mtimeMs: st.mtimeMs,
      mtimeIso: st.mtime.toISOString(),
    }
  } catch {
    return { path: relativePath, error: 'not_found' }
  }
}

function loadSparklineFromDisk() {
  try {
    const raw = fs.readFileSync(atlasTrajectoryPath, 'utf8')
    const rows = parsePortfolioTrajectoryCsv(raw)
    const points = downsampleTrajectoryForSparkline(rows)
    return points.length ? { points, field: 'portfolio_value' } : null
  } catch {
    return null
  }
}

export function registerAtlasRoutes(app) {
  app.get('/api/atlas/summary', async (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120')
    try {
      const summary = loadAtlasSummaryFromDisk()
      const freshness = {
        summary: statFreshness(REL_SUMMARY, atlasSummaryPath),
        trajectory: statFreshness(REL_TRAJECTORY, atlasTrajectoryPath),
      }
      const sparkline = loadSparklineFromDisk()

      res.json({
        ok: true,
        summary,
        sparkline,
        meta: {
          repoUrl: atlasRepoUrl,
          summaryPath: REL_SUMMARY,
          freshness,
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to load ATLAS summary.',
        meta: {
          repoUrl: atlasRepoUrl,
          summaryPath: REL_SUMMARY,
          freshness: {
            summary: statFreshness(REL_SUMMARY, atlasSummaryPath),
            trajectory: statFreshness(REL_TRAJECTORY, atlasTrajectoryPath),
          },
        },
      })
    }
  })
}
