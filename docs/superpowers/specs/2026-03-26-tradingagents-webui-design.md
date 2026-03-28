## TradingAgents Web UI (Option A2) — Design Spec

### Goal
Add a first-class Web UI inside the existing `stock-screener` app that can run **TradingAgents** analyses for a ticker/date and stream progress + final decision to the browser.

This integrates TradingAgents **server-side** (Python venv), keeping API keys and long-running execution off the client.

### Non-goals (for v1)
- Persistent job history (Supabase) / multi-user queueing
- Complex multi-ticker batch runs
- Fine-grained TradingAgents configuration surface area (we’ll expose a minimal set first)
- “Interactive” TradingAgents CLI UI in the browser (we will not emulate a TTY)

### Current repo constraints & leverage
- Frontend is **Vite + React Router**; routes are defined in `src/App.tsx`.
- Backend is **Express** with existing patterns for:
  - `POST` endpoints that run agent workflows
  - **SSE** (`text/event-stream`) for progress streaming (e.g. Harry fetch flow on `/agents`)
- System Python on macOS is **externally managed** (PEP 668). We already created a project venv flow:
  - `npm run install:tradingagents` → creates `.venv-tradingagents` and installs `-e ./vendor/TradingAgents`

### High-level architecture
- **UI route**: `GET /tradingagents` (React page)
- **API route**: `POST /api/tradingagents/run` (SSE)
- **Execution**:
  - Node spawns a Python process in `.venv-tradingagents`:
    - `.venv-tradingagents/bin/python scripts/tradingagents/run.py ...`
  - `run.py` imports TradingAgents as a library and emits newline-delimited JSON (**JSONL**) events to stdout.
  - Node converts JSONL → SSE `data: <json>\n\n` to the browser.

### User journey (v1)
1. User opens **TradingAgents** page.
2. Enters:
   - Ticker (e.g. `NVDA`)
   - Analysis date (default: today; user can choose)
   - Provider (e.g. `openai`, `anthropic`, etc.)
3. Clicks **Run TradingAgents**.
4. UI shows:
   - Streaming progress events
   - Final decision payload (copyable)
   - Clear error messaging when missing keys / missing venv / Python crash

### UI specification
#### Navigation
- Add internal header link labeled `TradingAgents UI` (or `TradingAgents`) to `/tradingagents`.
- Keep the existing external GitHub link to the upstream repo (optional; if we keep it, label it `TradingAgents Repo` to reduce confusion).

#### Page layout (`src/pages/TradingAgents.tsx`)
- **Left/top**: “Run” form
  - Ticker input (uppercase transform)
  - Date input
  - Provider select (v1: `openai | anthropic | google | xai | openrouter | ollama`)
  - Run button
- **Main**: Stream panel
  - “Status” line (running / done / error)
  - Scrollable log list (each event rendered with timestamp + message)
  - Final decision card when done
  - Copy-to-clipboard for decision JSON and/or formatted summary

#### UX constraints
- Single-run-at-a-time per browser session (disable Run while running; show Cancel if we support abort).
- Desktop-first, responsive down to tablet width.
- Accessible:
  - Button states (disabled, aria-busy)
  - Log panel uses semantic structure; errors announced

### API specification
#### `POST /api/tradingagents/run`
Starts a single TradingAgents run and streams progress + result.

- **Content-Type**: `application/json`
- **Accept**: `text/event-stream`
- **Response**: `200 text/event-stream`

##### Request body (v1)
```json
{
  "ticker": "NVDA",
  "asOf": "2026-01-15",
  "provider": "openai"
}
```

- `ticker` (string, required): will be uppercased + validated server-side.
- `asOf` (string, required): ISO date `YYYY-MM-DD`.
- `provider` (string, required): one of `openai | anthropic | google | xai | openrouter | ollama`.

##### SSE event schema (v1)
We will send **only `data:` lines** containing JSON.

Event types:
- `start`
- `progress`
- `result`
- `error`

Examples:
```text
data: {"type":"start","runId":"...","ticker":"NVDA","asOf":"2026-01-15","provider":"openai","at":"2026-03-26T12:00:00.000Z"}

data: {"type":"progress","phase":"boot","message":"Starting TradingAgents runner","at":"..."}

data: {"type":"progress","phase":"agents","message":"Analyst team: fundamentals","at":"..."}

data: {"type":"result","decision":{...},"at":"..."}

data: {"type":"error","message":"Missing OPENAI_API_KEY","at":"..."}
```

##### Error handling
Server should convert all failures into an `error` SSE event and end the stream:
- `.venv-tradingagents` missing → message tells user to run `npm run install:tradingagents`
- Python exits non-zero → include last stderr line(s) (redacted if it looks like a key)
- Missing provider API key → tell exactly which env var is required (e.g. `OPENAI_API_KEY`)
- Invalid input → 400 JSON (non-SSE) OR SSE `error` (pick one and keep consistent; prefer SSE so UI code path is uniform)

##### Concurrency & cancellation (v1)
- Enforce **one active run per client** (simple in-memory map keyed by IP + UA hash is enough for v1).
- Support client disconnect:
  - If client closes connection, kill the child process.
- Optional v1.1: `/api/tradingagents/cancel` to cancel explicitly.

Note: This is intentionally different from the existing Harry “background job” behavior (which persists across disconnect). For TradingAgents v1 we prefer “run is tied to the open browser session” to avoid orphaned expensive runs.

### Python runner contract
Add `scripts/tradingagents/run.py` with a stable CLI that:
- Imports `tradingagents` package (from `.venv-tradingagents`).
- Executes a single propagate call (initial target):
  - `TradingAgentsGraph(...).propagate(ticker, asOf)`
- Emits **JSONL** events to stdout:
  - One JSON object per line
  - Must flush after each line
- Writes all human-readable diagnostics to stderr (so Node can optionally capture)

Proposed JSONL messages emitted by Python:
- `{"type":"progress","phase":"boot","message":"...","at":"..."}`
- `{"type":"progress","phase":"running","message":"...","at":"..."}`
- `{"type":"result","decision":{...},"at":"..."}`
- `{"type":"error","message":"...","at":"..."}`

Node will emit an initial SSE `start` event after request validation (Python does not emit `start`).

### Server-side adapter (Node)
Add an Express route that:
- Validates request
- Builds python args
- Spawns:
  - `cwd`: repo root
  - `env`: inherits `process.env` (so provider keys work)
  - `stdio`: pipe stdout/stderr
- Parses stdout by line as JSON; forwards each parsed object as SSE `data: <json>\n\n`
- On parse errors, forward `error` SSE with “malformed runner output”
- On close:
  - if result not sent and exit code non-zero → `error`
  - end response

SSE response headers should match the repo’s existing streaming routes:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-store, must-revalidate`
- `Pragma: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`
- `res.flushHeaders()` if available

### Security
- Never accept API keys from the browser.
- Do not echo environment variables to SSE.
- Add basic input validation:
  - ticker: `/^[A-Z0-9.-]{1,12}$/`
  - asOf: parseable `YYYY-MM-DD` and reasonable bounds

### Testing
- Unit tests for:
  - Request validation (ticker/date/provider)
  - JSONL→SSE adapter parsing (including malformed line)
- Smoke test (manual):
  - with `OPENAI_API_KEY` set, run one ticker and confirm UI shows progress + decision

### Performance & operability
- First-run latency includes Python import + model call; UI must be resilient to long gaps.
- Add server-side timeout (e.g. 10 minutes) to kill hung runs.
- Logs should be truncated in UI (e.g. keep last 500 lines).

