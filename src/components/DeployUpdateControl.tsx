import { useCallback, useEffect, useRef, useState } from 'react'

type DeployStatus = {
  deployedSha: string | null
  remoteSha: string | null
  branch: string
  updateAvailable: boolean
  dispatchConfigured: boolean
  repo: string | null
  message?: string
  error?: string
}

const POLL_MS = 90_000

/**
 * Production only: polls /api/deploy/status and offers a trigger that POSTs /api/deploy/trigger.
 * You paste DEPLOY_SECRET (or CRON_SECRET) in a prompt — it is never stored in the bundle.
 */
export default function DeployUpdateControl() {
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const mounted = useRef(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/deploy/status', { credentials: 'same-origin' })
      const data = (await res.json()) as DeployStatus & { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setLoadError(data.error || res.statusText || 'Status failed')
        setStatus(null)
        return
      }
      setLoadError(null)
      setStatus(data)
    } catch (e) {
      if (!mounted.current) return
      setLoadError(e instanceof Error ? e.message : 'Network error')
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void fetchStatus()
    const id = window.setInterval(() => void fetchStatus(), POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(id)
    }
  }, [fetchStatus])

  const onTrigger = async () => {
    const secret = window.prompt(
      'Deploy secret (same as DEPLOY_SECRET or CRON_SECRET on the server). Not stored in the app.',
    )
    if (secret == null || !secret.trim()) return
    setBusy(true)
    setToast(null)
    try {
      const res = await fetch('/api/deploy/trigger', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret.trim()}`,
        },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToast(typeof data.error === 'string' ? data.error : `Trigger failed (${res.status})`)
        return
      }
      setToast(
        typeof data.message === 'string'
          ? data.message
          : 'Workflow started. Watchtower will pull the new image when GHCR updates.',
      )
      void fetchStatus()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!import.meta.env.PROD) return null

  if (loadError && !status) {
    return (
      <span className="text-xs text-amber-500/90 max-w-[10rem] truncate" title={loadError}>
        Deploy check: error
      </span>
    )
  }

  if (!status?.repo) {
    return null
  }

  const showBadge = status.updateAvailable
  const canTrigger = status.dispatchConfigured

  return (
    <div className="flex items-center gap-2 shrink-0">
      {showBadge ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-200"
          title={
            status.deployedSha && status.remoteSha
              ? `Running ${status.deployedSha} · origin/${status.branch} ${status.remoteSha}`
              : `origin/${status.branch} ${status.remoteSha ?? '—'}`
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
          New on GitHub
        </span>
      ) : null}
      {canTrigger ? (
        <button
          type="button"
          disabled={busy || !showBadge}
          onClick={() => void onTrigger()}
          className="rounded-md border border-slate-600 bg-slate-800/80 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            showBadge
              ? 'Dispatch GitHub Actions to rebuild and push :latest (Watchtower pulls on the server)'
              : 'Already matches GitHub (or deploy SHA unknown until next image build)'
          }
        >
          {busy ? 'Starting…' : 'Build & deploy'}
        </button>
      ) : null}
      {toast ? (
        <span className="text-xs text-slate-400 max-w-[14rem] truncate" title={toast}>
          {toast}
        </span>
      ) : null}
    </div>
  )
}
