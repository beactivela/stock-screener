# TradingAgents Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app `/tradingagents` page that runs TradingAgents server-side and streams progress + the final decision back to the browser over SSE.

**Architecture:** React page issues a `POST` to an Express SSE endpoint. Express spawns `.venv-tradingagents/bin/python scripts/tradingagents/run.py …`, reads JSONL from stdout, and forwards each JSON object as `data: <json>\n\n` SSE messages. Server emits a `start` event before spawn; runner emits `progress`/`result`/`error`.

**Tech Stack:** Vite + React Router + Tailwind (frontend), Express (backend), Node `child_process.spawn` + SSE, Python venv (`.venv-tradingagents`) with `tradingagents` installed from `vendor/TradingAgents`.

---

## File structure (new/modified units)

**Create**
- `server/http/registerTradingAgentsRoutes.js` — Express route `POST /api/tradingagents/run` (SSE) and validation; spawns Python runner; JSONL→SSE forwarding.
- `server/tradingagents/validation.js` — ticker/date/provider validation helpers (pure functions, easy to test).
- `server/tradingagents/jsonl.js` — JSONL parsing helpers (buffering + line splitting) used by SSE adapter (pure functions, easy to test).
- `scripts/tradingagents/run.py` — Python runner that imports `tradingagents` and prints JSONL progress + final result.
- `src/pages/TradingAgents.tsx` — UI page (form + streaming log + decision view).

**Modify**
- `server/index.js` — register the new TradingAgents routes.
- `src/App.tsx` — add route `/tradingagents`.
- `src/components/Layout.tsx` — add internal nav link to `/tradingagents` (and optionally rename the existing external link label to reduce confusion).

**Test**
- `server/tradingagents/validation.test.js`
- `server/tradingagents/jsonl.test.js`
- `server/http/registerTradingAgentsRoutes.test.js` (route-level behavior via mounting `app` and using fetch)
- (Optional) `src/utils/...` no new tests required; UI will be exercised manually for v1.

---

### Task 1: Add pure validation helpers (tests first)

**Files:**
- Create: `server/tradingagents/validation.js`
- Test: `server/tradingagents/validation.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTradingAgentsRunRequest } from './validation.js';

test('validateTradingAgentsRunRequest accepts valid input', () => {
  const out = validateTradingAgentsRunRequest({ ticker: 'NVDA', asOf: '2026-01-15', provider: 'openai' });
  assert.deepEqual(out, { ok: true, value: { ticker: 'NVDA', asOf: '2026-01-15', provider: 'openai' } });
});

test('validateTradingAgentsRunRequest rejects bad ticker', () => {
  const out = validateTradingAgentsRunRequest({ ticker: 'NVDA!!!', asOf: '2026-01-15', provider: 'openai' });
  assert.equal(out.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/tradingagents/validation.test.js`  
Expected: FAIL (module not found / function not defined)

- [ ] **Step 3: Write minimal implementation**

```js
export function validateTradingAgentsRunRequest(body) {
  // returns { ok: true, value } or { ok: false, error }
}
```

Include:
- Uppercase ticker
- `ticker` regex: `/^[A-Z0-9.-]{1,12}$/`
- `asOf` regex: `/^\\d{4}-\\d{2}-\\d{2}$/` and `new Date(asOf)` validity
- `provider` allowlist: `openai | anthropic | google | xai | openrouter | ollama`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/tradingagents/validation.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/tradingagents/validation.js server/tradingagents/validation.test.js
git commit -m "test: add TradingAgents run request validation"
```

---

### Task 2: Add JSONL parsing utilities (tests first)

**Files:**
- Create: `server/tradingagents/jsonl.js`
- Test: `server/tradingagents/jsonl.test.js`

- [ ] **Step 1: Write the failing tests**

Test the buffering behavior:
- partial line across chunks
- multiple lines in one chunk
- blank lines ignored
- malformed JSON yields `{ type: 'error', message: 'malformed runner output' }` or throws (choose one and be consistent)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/tradingagents/jsonl.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement minimal JSONL parser**

Provide something like:
- `createJsonlDecoder({ onEvent, onMalformed })` or
- `consumeJsonlChunk(state, chunkString)` returning `{ events, nextBuffer }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/tradingagents/jsonl.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/tradingagents/jsonl.js server/tradingagents/jsonl.test.js
git commit -m "test: add JSONL parser for TradingAgents runner output"
```

---

### Task 3: Add Express SSE route to spawn Python runner (tests first)

**Files:**
- Create: `server/http/registerTradingAgentsRoutes.js`
- Modify: `server/index.js`
- Test: `server/http/registerTradingAgentsRoutes.test.js`

- [ ] **Step 1: Write failing route tests**

Focus on:
- 400 on invalid body (or SSE error if you choose SSE-only; the spec prefers SSE-only for uniform UI—decide and encode here)
- emits a `start` SSE event immediately
- when runner prints a JSONL line, it forwards it as SSE `data: ...`
- if `.venv-tradingagents/bin/python` missing, stream `error` telling user to run `npm run install:tradingagents`

Implementation suggestion for testing: mount `app` from `server/index.js` with `SKIP_EXPRESS_LISTEN=1`, register routes, and hit it using the native `fetch` in Node 22 with `ReadableStream` parsing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/http/registerTradingAgentsRoutes.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement the route**

Requirements:
- Set SSE headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-store, must-revalidate`
  - `Pragma: no-cache`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`
  - Call `res.flushHeaders()` when present
- Emit `start` event with a generated `runId` (UUID) before spawning.
- Spawn:
  - `cmd`: `.venv-tradingagents/bin/python`
  - `args`: `scripts/tradingagents/run.py --ticker ... --as-of ... --provider ...`
  - `cwd`: repo root
  - `env`: `process.env`
- Parse stdout as JSONL and forward each event object as SSE `data: <json>\n\n`
- If client disconnects (`req.on('close')`):
  - kill child process
  - end response
- Timeout: kill after 10 minutes (configurable env var OK, but keep v1 simple)

Also implement:
- **Best-effort per-client concurrency guard**: reject a second concurrent run from the same client (e.g. 409 JSON or SSE `error` and close). Keep it in-memory for v1.
- **stderr handling**: keep a small rolling buffer of the last ~10 lines from stderr; if Python exits non-zero, include a concise error message in the final SSE `error` event (do not echo env vars).

Also modify `server/index.js` to call `registerTradingAgentsRoutes(app)` near other register calls (after `express.json()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/http/registerTradingAgentsRoutes.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/http/registerTradingAgentsRoutes.js server/index.js server/http/registerTradingAgentsRoutes.test.js
git commit -m "feat: add SSE route to run TradingAgents via python runner"
```

---

### Task 4: Implement Python runner script (manual smoke first, then add lightweight check)

**Files:**
- Create: `scripts/tradingagents/run.py`

- [ ] **Step 1: Implement minimal runner that emits JSONL**

Requirements:
- Parse args: `--ticker`, `--as-of`, `--provider`
- Print JSONL events and flush:
  - progress boot
  - progress running
  - result with `decision`
  - error on exception
- Import and call TradingAgents:
  - Mirror the working API usage from `vendor/TradingAgents/cli/main.py` (or the current `tradingagents` public API) rather than assuming `.propagate()` exists.
  - First goal: return a single final decision object that can be serialized to JSON.

- [ ] **Step 2: Manual smoke run (local)**

Run:
```bash
npm run install:tradingagents
OPENAI_API_KEY=... ./.venv-tradingagents/bin/python scripts/tradingagents/run.py --ticker NVDA --as-of 2026-01-15 --provider openai
```

Expected:
- Lines of JSON (one per line)
- Final line with `type=result`

- [ ] **Step 3: Commit**

```bash
git add scripts/tradingagents/run.py
git commit -m "feat: add TradingAgents python runner emitting JSONL"
```

---

### Task 5: Build the React page + streaming client

**Files:**
- Create: `src/pages/TradingAgents.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Add route in `src/App.tsx`**

Add lazy import and route:
- `const TradingAgents = lazy(() => import('./pages/TradingAgents'))`
- `<Route path="/tradingagents" element={<TradingAgents />} />`

- [ ] **Step 2: Add internal nav link in `src/components/Layout.tsx`**

Add a `Link to="/tradingagents"` in the header `<nav>`.

- [ ] **Step 3: Implement `src/pages/TradingAgents.tsx`**

UI requirements:
- Form state (ticker, date, provider)
- On submit:
  - `fetch('/api/tradingagents/run', { method:'POST', headers:{'Content-Type':'application/json', Accept:'text/event-stream'}, body: JSON.stringify(...) })`
  - Stream parse identical to the existing SSE parsing in `Agents.tsx`:
    - accumulate buffer, split on `\n`, handle `data:` lines
    - `JSON.parse(line.slice(5).trim())`
- Render:
  - status chip (idle/running/done/error)
  - scrollable log
  - decision card when `result` arrives
  - “Copy decision JSON” button
  - Keep the log bounded (e.g. last 500 events) so a long run doesn’t blow up the tab

- [ ] **Step 4: Manual UI verification**

Run:
```bash
npm run dev
```

Visit:
- `http://localhost:5173/tradingagents`

Expected:
- Submitting starts streaming
- Disconnecting page stops run (server kills child)

- [ ] **Step 5: Commit**

```bash
git add src/pages/TradingAgents.tsx src/App.tsx src/components/Layout.tsx
git commit -m "feat: add TradingAgents UI page with SSE streaming"
```

---

### Task 6: Full verification + cleanup

**Files:**
- Modify if needed: any above

- [ ] **Step 1: Run full test suite**

Run: `npm test`  
Expected: PASS

- [ ] **Step 1.5: Ensure new tests are included in `npm test`**

This repo’s `npm test` script enumerates test files explicitly. Add new tests to `package.json` test list:
- `server/tradingagents/validation.test.js`
- `server/tradingagents/jsonl.test.js`
- `server/http/registerTradingAgentsRoutes.test.js`

- [ ] **Step 2: Run linter**

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 3: Final manual smoke**

With keys set, run a single TradingAgents analysis in the UI and confirm decision renders.

- [ ] **Step 4: Commit any last fixes**

```bash
git add -A
git commit -m "chore: polish TradingAgents UI run flow"
```

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-03-26-tradingagents-webui.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — I execute tasks in this session with checkpoints.

Which approach?

