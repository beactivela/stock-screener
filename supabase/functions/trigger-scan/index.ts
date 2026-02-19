/**
 * Supabase Edge Function: trigger daily VCP scan.
 *
 * Invoked by Supabase Cron (e.g. daily at 5 PM CST = 23:00 UTC).
 * Calls your app's POST /api/cron/scan with CRON_SECRET.
 *
 * Set these secrets in Supabase (Dashboard → Project Settings → Edge Functions → Secrets):
 *   - SCAN_API_URL   e.g. https://your-app.railway.app (no trailing slash)
 *   - CRON_SECRET    same value as CRON_SECRET in your app's .env
 */

const SCAN_API_URL = Deno.env.get("SCAN_API_URL");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (_req: Request) => {
  if (!SCAN_API_URL?.trim()) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "SCAN_API_URL not set. Add it in Edge Function secrets.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const base = SCAN_API_URL.replace(/\/$/, "");
  const url = `${base}/api/cron/scan`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CRON_SECRET
          ? { Authorization: `Bearer ${CRON_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ triggeredAt: new Date().toISOString() }),
    });

    const status = res.status;
    let body: unknown;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    return new Response(
      JSON.stringify({
        ok: status >= 200 && status < 400,
        status,
        apiResponse: body,
      }),
      {
        status: status >= 400 ? status : 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Failed to call scan API",
        detail: message,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
});
