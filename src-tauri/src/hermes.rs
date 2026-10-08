//! Hermes lifecycle management.
//!
//! ## Architecture (confirmed by Windows spike, Gate 0 item 1)
//! Hermes is a Python-based tool installed via `uv` and registered as the
//! `hermes` CLI entry point. There is no standalone `.exe` to bundle as a
//! Tauri sidecar. Instead, we spawn `hermes --gateway` from PATH.
//!
//! API server config: `platforms.api_server.enabled=true` in
//! `~/.hermes/config.yaml`. Gate 1 requires users to have Hermes installed
//! and that file pre-configured (see agent/hermes_config.yaml for the
//! template). Gate 8 will bundle CPython + uv + Hermes deps in the installer
//! to remove the manual install step.
//!
//! ## Gate 1
//! Spawn `hermes --gateway` from PATH; forward stdout/stderr to React UI as
//! `hermes-log` events; kill on AppExit.
//!
//! ## Gate 4 (TODO)
//! Before spawning, write ~/.hermes/config.yaml with the user's OIDC token
//! substituted for `__USER_OIDC_TOKEN__`. The token is never stored on disk
//! beyond the in-memory substitution (Gate 0 item 8 — design TBD with owner).

use std::sync::Mutex;

use log::{error, info};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Child;

/// Managed Tauri state: the live Hermes child process, if running.
pub struct HermesProcess(pub Mutex<Option<Child>>);

/// Hermes CLI command — must be in PATH (installed via hermes-agent installer).
/// Gate 8: replace with bundled Python runtime path.
const HERMES_CMD: &str = "hermes";

/// Env vars set when spawning hermes --gateway.
/// `API_SERVER_PORT` / `API_SERVER_HOST`: where Hermes binds its OpenAI-compatible HTTP API.
/// Gate 4: add `API_SERVER_KEY` (random secret generated at app start; written to
/// config.yaml and used by src/lib/hermes.ts to authenticate requests to Hermes).
const API_SERVER_PORT: &str = "8642";
const API_SERVER_HOST: &str = "127.0.0.1";

/// Register state slot and fire an async task to spawn Hermes.
/// Returns immediately; startup errors are emitted as `hermes-error` events.
pub fn spawn(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Register the state slot synchronously so stop() can always find it.
    app.manage(HermesProcess(Mutex::new(None)));

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match spawn_async(&app_handle).await {
            Ok(child) => {
                if let Ok(mut guard) = app_handle.state::<HermesProcess>().0.lock() {
                    *guard = Some(child);
                }
                info!("Hermes started — API at http://{}:{}", API_SERVER_HOST, API_SERVER_PORT);
                let _ = app_handle.emit("hermes-ready", ());
            }
            Err(e) => {
                error!("Failed to start Hermes: {e}");
                let _ = app_handle.emit("hermes-error", format!("{e}"));
            }
        }
    });

    Ok(())
}

async fn spawn_async(
    app: &AppHandle,
) -> Result<Child, Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut child = tokio::process::Command::new(HERMES_CMD)
        .args(["--gateway"])
        .env("API_SERVER_PORT", API_SERVER_PORT)
        .env("API_SERVER_HOST", API_SERVER_HOST)
        // Gate 4: inject API_SERVER_KEY and LLM backend env vars here.
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Could not start Hermes (`{HERMES_CMD}` not found in PATH). \
                 Install from https://hermes-agent.nousresearch.com and ensure \
                 `{HERMES_CMD}` is on PATH. Underlying error: {e}"
            )
        })?;

    // Forward Hermes stdout to the React UI as `hermes-log` events.
    if let Some(stdout) = child.stdout.take() {
        let app_h = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                info!("[hermes] {line}");
                let _ = app_h.emit("hermes-log", &line);
            }
        });
    }

    // Forward Hermes stderr — errors go to log AND the UI.
    if let Some(stderr) = child.stderr.take() {
        let app_h = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                error!("[hermes] {line}");
                let _ = app_h.emit("hermes-log", &line);
            }
        });
    }

    Ok(child)
}

/// Kill Hermes cleanly. Called on window destroy (app exit).
pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<HermesProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.as_mut() {
                info!("Stopping Hermes…");
                // start_kill() sends TerminateProcess / SIGKILL without blocking.
                let _ = child.start_kill();
            }
            *guard = None;
        }
    }
}
