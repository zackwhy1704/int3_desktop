//! Hermes sidecar lifecycle management.
//!
//! Hermes Agent runs in gateway mode as a bundled sidecar, exposing an
//! OpenAI-compatible HTTP API at 127.0.0.1:8642. The React UI polls
//! /health and shows "connected" / "disconnected".
//!
//! ## Gate 0 item 1 note
//! The sidecar binary name and gateway CLI command are placeholders pending
//! the Hermes Windows spike. Update `HERMES_BINARY` and the args to
//! `sidecar().args(…)` once the spike confirms the correct invocation.
//!
//! ## Gate 1
//! Fire-and-forget spawn. Hermes is killed on AppExit.
//!
//! ## Gate 4 (TODO)
//! Before spawning, inject the OIDC token into Hermes config via a short-
//! lived in-memory mechanism (not written to disk — Gate 0 item 8).
//! Restart Hermes after token refresh.

use std::sync::Mutex;

use log::{error, info};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

/// Registered as Tauri managed state so commands and the exit handler can
/// access the child handle.
pub struct HermesProcess(pub Mutex<Option<CommandChild>>);

/// Name of the sidecar as declared in `externalBin` in tauri.conf.json.
/// Tauri resolves the platform-specific binary name (adds -x86_64-pc-windows-msvc.exe
/// on Windows) automatically.
///
/// TODO Gate 0 item 1: confirm binary name after Hermes Windows spike.
const HERMES_BINARY: &str = "hermes";

pub fn spawn(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let config_path = app
        .path()
        .resource_dir()
        .map(|p| p.join("resources").join("hermes_config.json"))
        .map_err(|e| format!("could not resolve resource dir: {e}"))?;

    info!("Spawning Hermes sidecar; config: {}", config_path.display());

    // TODO Gate 0 item 1: confirm the correct gateway-mode subcommand.
    // Placeholder uses "gateway start --config <path>".
    let sidecar = app
        .shell()
        .sidecar(HERMES_BINARY)
        .map_err(|e| format!("{HERMES_BINARY} sidecar not found — run scripts/download-hermes.js first. {e}"))?
        .args(["gateway", "start", "--config", &config_path.to_string_lossy()]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| { error!("Failed to spawn Hermes: {e}"); e })?;

    // Register child for later kill on exit.
    if app.try_state::<HermesProcess>().is_none() {
        app.manage(HermesProcess(Mutex::new(Some(child))));
    } else {
        *app.state::<HermesProcess>().0.lock()
            .map_err(|e| format!("mutex poisoned: {e}"))? = Some(child);
    }

    // Forward Hermes stdout/stderr to the Tauri window as "hermes-log" events
    // so the React UI can surface startup errors during development.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    info!("[hermes] {text}");
                    let _ = app_handle.emit("hermes-log", &text);
                }
                CommandEvent::Terminated(status) => {
                    error!("[hermes] process terminated: {:?}", status);
                    let _ = app_handle.emit("hermes-terminated", ());
                    break;
                }
                _ => {}
            }
        }
    });

    info!("Hermes sidecar spawned — API at http://127.0.0.1:8642");
    Ok(())
}

/// Kill the Hermes process cleanly. Called on app exit.
pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<HermesProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                info!("Stopping Hermes sidecar…");
                let _ = child.kill();
            }
        }
    }
}
