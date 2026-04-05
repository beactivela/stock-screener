/**
 * Always send a JSON body (avoids empty responses if res.json throws on odd values).
 */
export function sendJson(res, status, payload) {
  let body;
  let code = status;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    body = JSON.stringify({ ok: false, error: `JSON serialization failed: ${msg}` });
    code = 500;
  }
  if (res.headersSent) return;
  res.status(code);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}
