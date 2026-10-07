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
