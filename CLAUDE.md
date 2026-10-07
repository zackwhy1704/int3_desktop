# Company Brain Desktop — project context

## What this repo is

The desktop client for Company Brain. A Windows-first Tauri application that wraps the
Hermes Agent runtime as a bundled background process, giving non-technical staff a
single-install AI assistant that answers questions against their company's knowledge base.

The web console (`int3_ai/web/`) is the admin and management surface.
This repo is the staff-facing tool they open every day.

## Repositories

| Repo | Purpose |
|---|---|
| `int3_ai` | Backend (Python), gateway service, web console, Docker/Cloud Run |
| `int3_desktop` | **This repo** — Tauri shell, Hermes sidecar, MCP tools, installer |

## Architecture

```
User machine
  └── Company Brain.exe  (Tauri v2 shell + NSIS/MSI installer)
        ├── WebView2  →  React UI  (src/)
        ├── Hermes binary  (sidecar, bundled — user never sees it)
        │     └── gateway mode: listens on 127.0.0.1:8642
        │           ├── LLM calls  →  Company Brain Gateway (Cloud Run)
        │           └── MCP tools  →  brain MCP server  (agent/mcp/server.ts)
        │                                 └── BrainProvider  →  int3_ai backend (Cloud Run)
        └── Windows Credential Manager  (OIDC token storage)
```

## Architectural invariants (non-negotiable)

- **No brain content on device.** The client never holds a copy of any company document,
  claim, embedding, or retrieval result beyond what is displayed in the current session.
  Permissions are enforced server-side. A laptop with a text editor must not be able to
  read another tenant's data.
- **No API keys on device.** All LLM calls are proxied through the Company Brain Gateway.
  The Claude API key lives in Google Secret Manager, not in any desktop file.
- **No PowerShell MCP tools.** Endpoint security flags PowerShell execution. MCP tools
  must not invoke PowerShell. Use Win32 APIs or Node.js APIs instead.
- **MCP tool schemas are frozen after Gate 3.** The BrainProvider interface and tool
  schemas are the abstraction boundary between Hermes and the backend. Changing them
  after Gate 3 requires a coordinated release.
- **Hermes is a sidecar.** We do not fork or modify Hermes. If Hermes behaviour needs
  to change, configure it; never patch it.

## Engineering standards

### Read before writing
- Read the files you will change and their callers before proposing a change. Quote
  file:line when you claim something about the code. Never describe behaviour you have
  not read or run.
- Diagnose before fixing: for a bug, state the observed failure, the cause, and the
  evidence (command output) before editing.
- If a task contradicts an Architectural invariant or a Gate 0 item, stop and say so.
  Do not work around it.

### Architecture: separate I/O from logic (this is what "MVC" means here)
Neither repo is a classic MVC app. The rule that matters is: **transport and I/O at
the edges, pure logic in the middle, so the middle is unit-testable without Docker,
a database, a network, or an LLM.**

| Layer | Owns | Must not |
|---|---|---|
| Edge (FastAPI routes, Tauri commands, MCP tool handlers, React components) | parsing input, auth context, mapping to/from wire format | contain business rules, SQL, or prompt text |
| Service / domain (pure functions, plain classes) | decisions: scope resolution, refusal gate, citation validation, supersede rule, token handling | import FastAPI, psycopg, fetch, Tauri, React |
| Adapters (repositories, LLM client, HTTP clients, Hermes process) | talking to the outside world | make decisions |

- Dependencies point inward. Adapters are passed in (function args, FastAPI
  `Depends`, constructor injection), never imported as module globals inside logic.
- **Do not refactor the existing demo into layers for its own sake.** "No abstraction
  the current task doesn't need" still holds. Apply the layering to new code, and to
  an existing module only when you are already changing it and need a seam to test it.
  Propose any cross-module restructure as a plan first.

### Contracts are generated, never hand-copied
- The backend's FastAPI OpenAPI schema is the single source of truth for every HTTP
  contract. TypeScript types for web/ and int3_desktop are generated from it
  (e.g. `openapi-typescript`) and committed; CI fails if regeneration produces a diff.
- MCP tool input schemas are derived from one zod schema per tool (`McpServer.registerTool`
  with a zod shape), not a hand-written JSON schema alongside a separate zod parser.
- Model IDs, ports and base URLs live in one config location per service, read from
  env. No string literal for a model ID anywhere else.

### Testing standard
Three tiers. Every PR states which tiers it ran, with real output.

| Tier | Runs | Needs | Budget |
|---|---|---|---|
| unit | every save / every PR | nothing external — no Docker, DB, network, LLM | < 30 s per repo |
| integration | every PR in CI | Docker (Postgres+pgvector), mocked LLM | < 5 min |
| eval (`-m llm`) | before a gate, on demand | real Anthropic key | report pass rates, never retry to green |

Coverage — measured, not chased:
- **Changed lines in a PR: ≥ 80 % line coverage** (enforce with `diff-cover` /
  equivalent). This is the gate. A whole-repo number is reported, not enforced.
- **Invariant-critical code: 100 % branch coverage AND a named test per invariant.**
  This list is: scope resolution, retrieval scope filter, citation validation,
  refusal gate, answer-cache keying, claim append/supersede, gateway auth, token
  storage, BrainProvider error mapping. A test name says which invariant it guards
  (`test_cache_key_differs_when_scopes_differ`).
- Coverage of glue (React layout, Tauri `main`, Dockerfiles) is not a goal. Do not
  write tests that only execute lines; every test asserts a behaviour.
- A failing or flaky test is reported as a result. Never delete, skip, loosen an
  assertion or raise a threshold to get green without the owner's explicit OK.

Test design rules:
- Arrange-Act-Assert; one behaviour per test; no logic (loops/ifs) that hides which
  case failed — use parametrisation.
- Mock at adapter boundaries only (LLM client, DB repository, HTTP, Hermes process).
  Never mock the unit under test or the scope-filter SQL itself.
- Every bug fix lands with a test that failed before the fix. Show it failing.
- Security-relevant tests are negative tests: forged token rejected, foreign scope
  absent, out-of-set citation refused.

### Change hygiene
- Small PRs, one concern each. Flag anything you touched outside the planned surface.
- Format + lint + typecheck must pass locally before you report done
  (Python: `ruff check`, `ruff format --check`, `mypy` on touched modules;
  TS: `tsc --noEmit`, `eslint`; Rust: `cargo fmt --check`, `cargo clippy -D warnings`).
- Reports use the ladder: does-not-compile / compiles / unit pass / integration pass /
  ran locally / ran on Windows CI. Claim only the highest rung you actually reached.
- Secrets: never in code, config templates written to disk, logs, or test fixtures.

## int3_desktop specifics (Tauri, React, MCP)

### Layout target
```
src-tauri/src/
  main.rs       calls int3_desktop_lib::run() — nothing else
  lib.rs        builder, plugin + command registration only
  commands.rs   #[tauri::command] fns: thin, delegate to core
  core/         pure Rust: config rendering, token lifecycle, sidecar supervision policy
  sidecar.rs    process spawn/kill adapter (behind a trait so core is testable)
src/
  api/          generated types + typed clients (only place that calls fetch/invoke)
  features/<x>/ components (presentational) + hooks (state, effects)
agent/mcp/
  tools/        one file per tool: zod schema + pure formatter + handler
  brain/        BrainProvider interface + adapters
```
- Rust: `cargo test` for `core/`; `cargo llvm-cov` for coverage; `tauri::test`
  mock runtime (feature `test`) only where a command must be exercised with an
  AppHandle. No `unwrap()`/`expect()` outside `main`/tests — return `Result`.
- React: Vitest + Testing Library; mock IPC with `@tauri-apps/api/mocks`
  (`mockIPC`, `clearMocks` in `afterEach`). Test hooks and the API client, not CSS.
- MCP: test each tool's formatter as a pure function, and the server end-to-end
  with the SDK's in-memory transport and a fake BrainProvider. Snapshot the tool
  list so any schema change is a visible, reviewed diff (schemas are a contract).
- CI (Windows runner) runs: `tsc --noEmit` for UI and agent, eslint, vitest,
  `cargo fmt/clippy/test`, then the bundle. A bundle build is not a test.

## Tech decisions

| Decision | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri v2 (Rust core + WebView2) | Smaller binary than Electron, native Windows signing, MSI/NSIS bundler built in |
| Agent runtime | Hermes Agent (NousResearch, MIT) | MCP host, OpenAI-compatible local API on 127.0.0.1:8642, headless gateway mode, Windows Task Scheduler support |
| UI | React 18 + TypeScript + Vite | Matches web console stack, one mental model |
| MCP SDK | @modelcontextprotocol/sdk | Official SDK, stdio transport for Hermes → brain server |
| LLM routing | Company Brain Gateway (Cloud Run) | Provider keys server-side, metered, swappable |
| Auth | Google OIDC via Tauri WebView2 | Same provider as web console; token stored in Windows Credential Manager |
| Credential storage | tauri-plugin-stronghold / keyring-rs | OS-native, never written to disk in plaintext |
| Installer | NSIS (per-user) + WiX MSI (Intune) | Both targets from one Tauri build |
| Code signing | OV certificate | Required to avoid SmartScreen warnings on customer machines |
| Cloud | Google Cloud Run + Cloud SQL, Singapore | See int3_ai CLAUDE.md |

## BrainProvider abstraction (thin-client today, local-capable tomorrow)

All brain queries flow through a single interface:

```typescript
interface BrainProvider {
  search(query: string, scopes: string[]): Promise<SearchResult[]>;
  getClaim(claimId: string): Promise<Claim>;
  listSources(scopes: string[]): Promise<Source[]>;
}
```

- **Today:** `BRAIN_PROVIDER=remote` → `RemoteBrainProvider` → calls `int3_ai` backend.
- **Future:** `BRAIN_PROVIDER=local` → `LocalBrainProvider` → Ollama + local pgvector snapshot.
  Flipping the config key is the only change needed in this repo. Hermes and MCP tool
  schemas are unaffected. Local mode enables offline queries and eliminates token costs.

The `LocalBrainProvider` class exists as a documented stub (`agent/mcp/brain/local.ts`).
Do not implement it until a customer requests it.

## Hermes sidecar details

- Binary location: `src-tauri/binaries/hermes-x86_64-pc-windows-msvc.exe`
- Downloaded in CI by `scripts/download-hermes.js` before every Tauri build.
- The binary is `.gitignore`d — never commit it.
- Tauri spawns it via `tauri-plugin-shell` sidecar API on app startup.
- Hermes reads `agent/hermes_config.json` (bundled as a Tauri resource).
- **Gate 4:** before spawning, Tauri writes the user's OIDC token into the config
  so Hermes can authenticate to the gateway and brain API.
- The brain MCP server (`agent/mcp/server.ts`) is spawned by Hermes as a stdio child
  process; it is not spawned directly by Tauri.

## Gate plan

### Gate 1 — Skeleton + Hermes sidecar ✦ build first
**Criteria:** App installs, Hermes starts silently, React UI shows "connected".

- [ ] Tauri app scaffolded, builds on Windows
- [ ] Hermes binary downloads in CI (`scripts/download-hermes.js`)
- [ ] Hermes starts as sidecar (`src-tauri/src/hermes.rs`)
- [ ] React UI polls `127.0.0.1:8642/health` and shows status
- [ ] NSIS installer runs on a fresh Windows machine

### Gate 2 — Gateway (done in int3_ai)
**Criteria:** All LLM calls proxied through gateway, no Claude key on device.

### Gate 3 — Brain MCP tools
**Criteria:** Hermes can answer a brain question via MCP tool call.

- [ ] `brain_search`, `get_claim`, `list_sources` tools implemented
- [ ] `RemoteBrainProvider` calls int3_ai backend
- [ ] `LocalBrainProvider` stub present with TODOs
- [ ] `BRAIN_PROVIDER` config switch wired through factory
- [ ] Hermes config registers brain MCP server
- [ ] End-to-end: question → Hermes → MCP tool → backend → answer

### Gate 4 — Auth
**Criteria:** Sign in with Google OIDC, token flows to gateway + backend, sign-out works.

- [ ] OIDC flow via Tauri WebView2
- [ ] Token in Windows Credential Manager (never on disk)
- [ ] Token injected into hermes_config.json at runtime before sidecar spawn
- [ ] Sign-out: clear token, restart Hermes
- [ ] Cross-tenant isolation verified

### Gate 5 — React UI (chat interface)
**Criteria:** Non-technical user can ask a question and see a cited answer.

- [ ] Chat message input + streaming response
- [ ] Source citation cards (clickable)
- [ ] Superseded claim diff display
- [ ] Refusal display ("No authorized source")
- [ ] Sign-in screen

### Gate 6 — External MCP tools (Gmail + Drive)
**Criteria:** Agent can cross-reference email/docs with brain.

- [ ] Gmail MCP server registered in Hermes config
- [ ] Drive MCP server registered in Hermes config
- [ ] Google OIDC token scoped for gmail.readonly + drive.readonly

### Gate 7 — BrainProvider flexibility sealed
**Criteria:** Interface frozen, local mode documented, switching is a config change.

- [ ] BrainProvider interface finalised and marked stable
- [ ] LocalBrainProvider TODOs documented
- [ ] `BRAIN_PROVIDER=local` fails gracefully, not with an uncaught exception

### Gate 8 — Packaging + distribution
**Criteria:** Clean install on fresh Windows VM, no SmartScreen warnings.

- [ ] MSI (WiX) for Intune deployment
- [ ] NSIS per-user installer
- [ ] OV code signing applied
- [ ] Auto-updater wired to Cloud Run endpoint
- [ ] Hermes binary bundled or first-run silent download (decide at this gate)

### Gate 9 — Cloud Run production (done in int3_ai)
**Criteria:** All services live in Singapore; no localhost in any config.

## Repo layout

```
int3_desktop/
  src/                        React UI
    lib/hermes.ts             Hermes HTTP client (calls 127.0.0.1:8642)
  src-tauri/
    src/
      main.rs                 Tauri entry, plugin setup, sidecar spawn
      hermes.rs               Sidecar lifecycle management
    binaries/                 Hermes binary lives here (gitignored)
    tauri.conf.json
    Cargo.toml
  agent/
    hermes_config.json        Pre-baked Hermes config (bundled as Tauri resource)
    mcp/
      server.ts               MCP stdio server entry — Hermes spawns this
      brain/
        provider.ts           BrainProvider interface + types
        remote.ts             RemoteBrainProvider
        local.ts              LocalBrainProvider stub
        index.ts              Factory (reads BRAIN_PROVIDER env)
      tools/
        brain_search.ts
        get_claim.ts
        list_sources.ts
  scripts/
    download-hermes.js        CI: downloads Hermes binary for current platform
  .github/workflows/
    build.yml                 Windows runner: download Hermes → build Tauri → MSI
```

## Gate 0: verified blockers

Each item was reproduced or read in source on 2026-10-07. Do not "fix" the
architectural ones (1–3) on your own — write up options and stop.

1. **The Hermes sidecar premise does not hold as written.** Hermes Agent is a Python
   app supported on Linux/macOS/WSL2, not native Windows; there is no standalone
   Windows binary. It is configured through `~/.hermes/config.yaml` (`mcp_servers:`
   mapping) and `API_SERVER_*` env vars, not the JSON shape in
   `agent/hermes_config.json`. `scripts/download-hermes.js` points at an asset name
   that the script itself marks unconfirmed. → Spike: confirm against Hermes's own
   repo/docs, then present options (e.g. desktop calls backend `/api/ask` directly
   for Gates 1–5 and defers an agent runtime to Gate 6; package Python+Hermes;
   another runtime). Owner decides.
2. **The Hermes path breaks the structural-citation invariant.** Through Hermes, the
   final answer is written by an LLM from tool text, and citation is a prompt
   instruction in `brain_search`'s description. The backend already returns answers
   whose citations are schema-constrained. Any design must keep citations structural
   end to end.
3. **Desktop ↔ backend contract does not exist.** `RemoteBrainProvider` calls
   `POST /v1/search`, `GET /v1/claims/{id}`, `GET /v1/sources` with a Bearer token;
   the backend serves `GET /api/search`, `POST /api/ask`, `GET /api/documents/{id}`
   with `X-User-Id`, and takes one `brain_id`, not a scope list. Define the contract
   in the backend first (Part A, generated types).
4. **Gateway does not start in its container.** `gateway/Dockerfile` runs
   `uvicorn main:app` from inside the package; `main.py` uses relative imports →
   `ImportError: attempted relative import with no known parent package`.
5. **Gateway auth fails open.** `GATEWAY_AUTH` defaults to `"oidc"`, whose
   implementation is a stub that accepts any non-empty token (returns
   `"stub-unverified"`). Until real verification exists, any mode other than an
   explicit `none` in local Compose must reject every request.
6. **Gateway drops tool calling.** `tools` is not forwarded and `role: tool` /
   `tool_calls` messages are passed to Anthropic unmodified, so any agent using MCP
   tools through the gateway cannot work. Also: `finish_reason` carries Anthropic
   values, text blocks are joined with spaces, the streaming error frame is not
   valid JSON, and nothing is metered or cached despite the invariant.
7. **Desktop build is broken.** `npm run agent:build` fails with TS5097 (`.ts`
   import extensions without `allowImportingTsExtensions`/rewrite); `tauri.conf.json`
   references `icons/*` that don't exist; the updater is configured under
   `bundle.updater` (v1 shape) — v2 needs `plugins.updater`,
   `bundle.createUpdaterArtifacts`, and the `tauri-plugin-updater` crate/package.
   Hermes config points at `agent/mcp/server.js`, which is never produced or bundled,
   and runs it with `node`, which customer machines won't have.
8. **Token-on-disk contradiction.** Gate 4 plans to write the OIDC token into a
   config file and env vars for child processes; the invariant says never on disk.
   Pick a mechanism that honours the invariant (short-lived token passed in memory,
   or a local token broker) before Gate 4.
9. **Smaller desktop defects:** `main.rs` duplicates `lib.rs` instead of calling
   `run()`; the Hermes child is never killed on app exit; `mutex.lock().unwrap()`;
   `streamChat` splits SSE per network read without buffering partial lines and
   without `decode(…, {stream: true})`.
10. **Model ID drift:** `claude-sonnet-5-5` (backend, .env.example) vs
    `claude-sonnet-4-6` (gateway default, hermes_config). One config source.
11. **Scope check:** int3_ai/CLAUDE.md lists the gateway, a desktop shell and an agent
    runtime as out of scope for the demo, and says never build a second thing before
    the first has users. Both now exist. Confirm with the owner which document is
    current before building further on either.

## How we work

- Same principles as `int3_ai`: plan before large changes, evals gate merges,
  surgical changes only.
- **Windows CI is the source of truth for builds.** Never assume a build works
  until the GitHub Actions Windows runner confirms it.
- **Hermes binary is never committed.** `scripts/download-hermes.js` fetches it in CI.
  Pin `HERMES_VERSION` in the workflow when you need reproducibility.
- **MCP tool schemas are the contract.** Any change to tool name, input schema, or
  return shape must be treated as a breaking change and gated on cross-team review.
- Test cross-user isolation at every gate that touches auth or provider routing.
