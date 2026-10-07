# Company Brain — Desktop

Windows-first desktop agent for Company Brain. Staff ask questions in plain language
and get cited answers drawn from their company's knowledge base.

**Non-technical install:** one `.exe` or `.msi`, sign in with Google, done.

## Prerequisites (dev)

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI prerequisites for Windows](https://tauri.app/start/prerequisites/)

## Getting started

```bash
npm install
node scripts/download-hermes.js   # downloads Hermes binary for your platform
npm run tauri dev                  # launches app in dev mode (hot-reload)
```

## Build installer

```bash
npm run tauri build                # produces MSI + NSIS in src-tauri/target/release/bundle/
```

## Project context

See [CLAUDE.md](CLAUDE.md) for architecture decisions, gate plan, and invariants.
See [int3_ai](https://github.com/zackwhy1704/int3_ai) for the backend and gateway.
