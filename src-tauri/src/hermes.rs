//! Hermes sidecar lifecycle management.
//!
//! Hermes Agent (NousResearch/hermes-agent, MIT) runs as a bundled sidecar
//! binary in gateway mode. It listens on 127.0.0.1:8642 and exposes an
//! OpenAI-compatible HTTP API that the React UI calls directly.
//!
//! The React UI never communicates with this module — it only speaks HTTP to
//! Hermes at 127.0.0.1:8642. This module's only job is to start and, in future
//! gates, restart Hermes when the OIDC token changes.
//!
//! ## Gate 1
//! Fire-and-forget spawn. The UI polls /health and shows "connected" / "disconnected".
//!
//! ## Gate 4 (TODO)
//! 1. Receive OIDC token from the sign-in flow (via a Tauri command).
//! 2. Write the token into hermes_config.json in the app data directory.
//! 3. Kill the current Hermes process and call spawn() again.
//!
//! ## Binary location
//! `src-tauri/binaries/hermes-x86_64-pc-windows-msvc.exe` (gitignored).
//! Downloaded in CI by `scripts/download-hermes.js`.
//! Tauri bundles it via `externalBin` in tauri.conf.json.

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use log::{error, info};

/// Holds the running Hermes child process so Gate 4 can restart it.
pub struct HermesState {
    pub child: Mutex<Option<CommandChild>>,
}

/// Spawns Hermes in gateway mode.
///
/// Reads the bundled hermes_config.json from the Tauri resource directory.
/// On error, logs and returns — the UI will show "disconnected" and retry via polling.
pub fn spawn(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let config_path = app
        .path()
        .resource_dir()
        .map(|p| p.join("resources").join("hermes_config.json"))
        .map_err(|e| format!("could not resolve resource dir: {e}"))?;

    info!("Spawning Hermes sidecar, config: {}", config_path.display());

    let (mut _rx, child) = app
        .shell()
        .sidecar("hermes")
        .map_err(|e| format!("hermes sidecar not found — did download-hermes.js run? {e}"))?
        .args(["gateway", "start", "--config", &config_path.to_string_lossy()])
        .spawn()
        .map_err(|e| { error!("Failed to spawn Hermes: {e}"); e })?;

    // Store child handle for Gate 4 restart.
    // If HermesState was not yet registered (first call), manage it here.
    if let Some(state) = app.try_state::<HermesState>() {
        *state.child.lock().unwrap() = Some(child);
    } else {
        app.manage(HermesState {
            child: Mutex::new(Some(child)),
        });
    }

    info!("Hermes sidecar spawned. API available at http://127.0.0.1:8642");

    // TODO Gate 1 follow-up: forward Hermes stderr/stdout from _rx to the
    // app log so startup errors are visible during development.

    Ok(())
}
