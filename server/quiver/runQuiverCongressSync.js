/**
 * Fetch Quiver politician + strategy pages (batched, delayed), persist metrics and 90d trades.
 * Opt-in: QUIVER_SYNC=1. Does not block unified experts sync unless EXPERTS_ALLOW_QUIVER_FAIL=0.
 */
import { getSupabase } from '../supabase.js'
import { fmpNameKeyFromParts } from './fmpNameKey.js'
import { fetchTextWithRetry, politicianPageUrl, strategyPageUrl } from './fetchPages.js'
import { parsePoliticianPageEmbedded } from './parsePoliticianHtml.js'
import { parseGraphDataStrategy } from './parseStrategyGraphHtml.js'
import { horizonReturnsFromGraph } from './computeHorizonReturns.js'
import { filterTradesLastDays } from './tradeRows.js'
import { resolveBioguideViaCongressGov } from './congressGovResolve.js'

const INSERT_BATCH = 200

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function envInt(name, def) {
  const v = process.env[name]
  if (v == null || v === '') return def
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

/**
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, runId?: string, error?: string, attempted?: number, okCount?: number, skippedCount?: number }>}
 */
export async function runQuiverCongressSync() {
  if (process.env.QUIVER_SYNC !== '1') {
    return { ok: true, skipped: true, reason: 'QUIVER_SYNC not set to 1' }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' }
  }

  const delayMs = Math.max(0, envInt('QUIVER_DELAY_MS', 1200))
  const maxPoliticians = Math.max(1, envInt('QUIVER_MAX_POLITICIANS', 40))
  const batchPauseEvery = Math.max(1, envInt('QUIVER_BATCH_SIZE', 8))
  const batchPauseMs = Math.max(0, envInt('QUIVER_BATCH_PAUSE_MS', 8000))
  const tradeDays = Math.max(1, envInt('QUIVER_TRADE_LOOKBACK_DAYS', 90))

  const { data: runRow, error: runErr } = await supabase
    .from('quiver_sync_runs')
    .insert({
      status: 'running',
      politicians_attempted: 0,
      politicians_ok: 0,
      politicians_skipped: 0,
    })
    .select('id')
    .single()

  if (runErr || !runRow) {
    return { ok: false, error: runErr?.message || 'failed to create quiver_sync_runs row' }
  }

  const runId = runRow.id
  let attempted = 0
  let okCount = 0
  let skippedCount = 0
  const govCache = new Map()

  try {
    const { data: fmpRun, error: fmpErr } = await supabase
      .from('fmp_sync_runs')
      .select('id')
      .eq('status', 'completed')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (fmpErr) throw fmpErr
    if (!fmpRun?.id) {
      throw new Error('No completed fmp_sync_runs row — run FMP congress sync first')
    }

    const { data: tradeRows, error: trErr } = await supabase
      .from('fmp_congress_trades')
      .select('first_name, last_name')
      .eq('sync_run_id', fmpRun.id)

    if (trErr) throw trErr

    /** @type {Map<string, { first_name: string, last_name: string }>} */
    const distinct = new Map()
    for (const r of tradeRows || []) {
      const fn = r.first_name != null ? String(r.first_name) : ''
      const ln = r.last_name != null ? String(r.last_name) : ''
      const key = fmpNameKeyFromParts(fn, ln)
      if (!key) continue
      if (!distinct.has(key)) distinct.set(key, { first_name: fn, last_name: ln })
    }

    const { data: identities, error: idErr } = await supabase
      .from('congress_politician_identity')
      .select('bioguide_id, full_name, fmp_name_key, quiver_path_suffix')

    if (idErr) throw idErr

    /** @type {Map<string, { bioguide_id: string, full_name: string, fmp_name_key: string, quiver_path_suffix: string | null }>} */
    const byKey = new Map()
    for (const row of identities || []) {
      if (row.fmp_name_key) byKey.set(row.fmp_name_key, row)
    }

    /** @type {Array<{ bioguide_id: string, full_name: string, fmp_name_key: string, quiver_path_suffix: string | null, first_name: string, last_name: string }>} */
    const toFetch = []

    for (const [key, names] of distinct) {
      if (toFetch.length >= maxPoliticians) break
      let idRow = byKey.get(key)
      if (!idRow) {
        const bi = await resolveBioguideViaCongressGov(names.first_name, names.last_name, govCache)
        if (!bi) {
          skippedCount++
          continue
        }
        const fullName = `${names.first_name} ${names.last_name}`.trim()
        const { error: upErr } = await supabase.from('congress_politician_identity').upsert(
          {
            bioguide_id: bi,
            full_name: fullName,
            fmp_name_key: key,
            source: 'congress_gov',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bioguide_id' }
        )
        if (upErr) {
          skippedCount++
          continue
        }
        idRow = {
          bioguide_id: bi,
          full_name: fullName,
          fmp_name_key: key,
          quiver_path_suffix: null,
        }
        byKey.set(key, idRow)
      }
      toFetch.push({
        ...idRow,
        first_name: names.first_name,
        last_name: names.last_name,
      })
    }

    let idx = 0
    for (const p of toFetch) {
      attempted++
      idx++

      let polHtml
      try {
        const polPath = p.quiver_path_suffix?.trim()
        const polUrl = polPath
          ? `https://www.quiverquant.com/congresstrading/politician/${encodeURIComponent(polPath)}`
          : politicianPageUrl(p.full_name, p.bioguide_id)
        polHtml = await fetchTextWithRetry(polUrl)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[quiver] politician fetch failed ${p.bioguide_id}:`, msg)
        skippedCount++
        await sleep(delayMs)
        continue
      }

      const parsed = parsePoliticianPageEmbedded(polHtml)
      if (!parsed || parsed.bioguideId !== p.bioguide_id) {
        console.warn(`[quiver] parse politician failed ${p.bioguide_id}`)
        skippedCount++
        await sleep(delayMs)
        continue
      }

      const displayForStrategy = parsed.directOrderName || p.full_name
      let stratHtml
      try {
        stratHtml = await fetchTextWithRetry(strategyPageUrl(displayForStrategy))
      } catch (e) {
        console.warn(`[quiver] strategy fetch failed ${p.bioguide_id}:`, e instanceof Error ? e.message : e)
      }

      const graph = stratHtml ? parseGraphDataStrategy(stratHtml) : null
      const asOf = new Date()
      const horizons = graph?.length
        ? horizonReturnsFromGraph(graph, asOf, [1, 3, 5, 10])
        : {
            perf_1y_pct: null,
            perf_3y_pct: null,
            perf_5y_pct: null,
            perf_10y_pct: null,
            strategy_start_date: null,
          }

      const recent = filterTradesLastDays(parsed.tradeRows, tradeDays, asOf)

      const { error: mErr } = await supabase.from('quiver_politician_metrics').insert({
        sync_run_id: runId,
        bioguide_id: p.bioguide_id,
        perf_1y_pct: horizons.perf_1y_pct,
        perf_3y_pct: horizons.perf_3y_pct,
        perf_5y_pct: horizons.perf_5y_pct,
        perf_10y_pct: horizons.perf_10y_pct,
        strategy_start_date: horizons.strategy_start_date,
        raw_json: { graphPoints: graph?.length ?? 0, displayForStrategy },
      })
      if (mErr) throw new Error(mErr.message)

      const tradePayload = []
      for (const t of recent) {
        tradePayload.push({
          sync_run_id: runId,
          bioguide_id: p.bioguide_id,
          transaction_date: t.transaction_date,
          filed_date: t.filed_date,
          symbol: t.symbol,
          transaction_type: t.transaction_type,
          description: t.description,
          amount_range: t.amount_range,
          chamber: t.chamber,
          excess_return_pct: t.excess_return_pct,
          raw_json: t.raw_json,
        })
      }

      for (let i = 0; i < tradePayload.length; i += INSERT_BATCH) {
        const chunk = tradePayload.slice(i, i + INSERT_BATCH)
        if (chunk.length === 0) continue
        const { error: insErr } = await supabase.from('quiver_politician_trades').insert(chunk)
        if (insErr) throw new Error(insErr.message)
      }

      okCount++
      await sleep(delayMs)
      if (idx % batchPauseEvery === 0 && idx < toFetch.length) {
        await sleep(batchPauseMs)
      }
    }

    await supabase
      .from('quiver_sync_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        politicians_attempted: attempted,
        politicians_ok: okCount,
        politicians_skipped: skippedCount,
      })
      .eq('id', runId)

    return {
      ok: true,
      runId,
      attempted,
      okCount,
      skippedCount,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('quiver_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        politicians_attempted: attempted,
        politicians_ok: okCount,
        politicians_skipped: skippedCount,
        error_message: msg,
      })
      .eq('id', runId)
    return { ok: false, error: msg, runId }
  }
}
