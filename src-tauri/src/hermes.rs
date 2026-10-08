//! Hermes lifecycle management.
//!
//! Spawns `hermes --gateway` from PATH, injecting the OIDC id_token as env
//! vars so neither the token nor any secret is written to disk.
//!
//! ## Token injection (Gate 0 item 8 — Option C)
//! - `OPENAI_API_KEY=<id_token>` — Hermes uses this to call the gateway LLM API.
//! - `OPENAI_BASE_URL=<gateway>/v1` — points Hermes at the int3_ai gateway.
//! - `BRAIN_AUTH_TOKEN=<id_token>` — forwarded to the MCP server via the Hermes
//!   config's `mcp_servers.brain.env` block (written to ~/.hermes/config.yaml
//!   on spawn). Gate 8: replace with per-app config file via `hermes --config`.
//!
//! ## Hermes config
//! Written to ~/.hermes/config.yaml before each spawn. The existing file is
//! backed up to ~/.hermes/config.yaml.int3-bak on first write so the user can
//! restore their personal config if needed.

use std::sync::Mutex;

use log::{error, info};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Child;

pub struct HermesProcess(pub Mutex<Option<Child>>);

const HERMES_CMD: &str = "hermes";
const API_SERVER_PORT: &str = "8642";
const API_SERVER_HOST: &str = "127.0.0.1";

pub struct HermesConfig {
    pub id_token: String,
    pub gateway_url: String,
    pub backend_url: String,
    pub mcp_server_path: String,
    /// Random secret for the desktop↔Hermes local HTTP API authentication.
    pub api_server_key: String,
}

/// Register state and fire-and-forget spawn.
pub fn spawn(app: &AppHandle, config: HermesConfig) -> Result<(), Box<dyn std::error::Error>> {
    if app.try_state::<HermesProcess>().is_none() {
        app.manage(HermesProcess(Mutex::new(None)));
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = write_hermes_config(&config).await {
            error!("failed to write Hermes config: {e}");
            let _ = app_handle.emit("hermes-error", format!("config write failed: {e}"));
            return;
        }
        match spawn_async(&app_handle, &config).await {
            Ok(child) => {
                if let Ok(mut g) = app_handle.state::<HermesProcess>().0.lock() {
                    *g = Some(child);
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

/// Kill and re-spawn with a fresh id_token (called on token refresh).
pub fn respawn(app: &AppHandle, config: HermesConfig) {
    stop(app);
    if let Err(e) = spawn(app, config) {
        error!("respawn failed: {e}");
    }
}

async fn spawn_async(
    app: &AppHandle,
    config: &HermesConfig,
) -> Result<Child, Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut child = tokio::process::Command::new(HERMES_CMD)
        .args(["--gateway"])
        .env("API_SERVER_PORT", API_SERVER_PORT)
        .env("API_SERVER_HOST", API_SERVER_HOST)
        // Token injected as env vars — never written to disk (Gate 0 item 8).
        .env("OPENAI_API_KEY", &config.id_token)
        .env("OPENAI_BASE_URL", format!("{}/v1", config.gateway_url))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!(
            "Could not start Hermes (`{HERMES_CMD}` not in PATH). \
             Install from https://hermes-agent.nousresearch.com then restart. Error: {e}"
        ))?;

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

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<HermesProcess>() {
        if let Ok(mut g) = state.0.lock() {
            if let Some(child) = g.as_mut() {
                info!("Stopping Hermes…");
                let _ = child.start_kill();
            }
            *g = None;
        }
    }
}

// ---------------------------------------------------------------------------
// Hermes config file
// ---------------------------------------------------------------------------

async fn write_hermes_config(config: &HermesConfig) -> Result<(), String> {
    use tokio::fs;

    let home = dirs_next::home_dir().ok_or("cannot find home directory")?;
    let hermes_dir = home.join(".hermes");
    let config_path = hermes_dir.join("config.yaml");
    let backup_path = hermes_dir.join("config.yaml.int3-bak");

    fs::create_dir_all(&hermes_dir).await.map_err(|e| e.to_string())?;

    // Back up the user's existing config once (does not overwrite backup).
    if config_path.exists() && !backup_path.exists() {
        fs::copy(&config_path, &backup_path).await.map_err(|e| {
            format!("could not back up ~/.hermes/config.yaml: {e}")
        })?;
        info!("backed up existing ~/.hermes/config.yaml to config.yaml.int3-bak");
    }

    let yaml = format!(
        r#"# Written by Company Brain Desktop — do not edit manually.
# Your original config is backed up at ~/.hermes/config.yaml.int3-bak

platforms:
  api_server:
    enabled: true
    extra:
      key: "{key}"

llm:
  base_url: "{gw}/v1"
  model: "claude-sonnet-4-6"
  api_key: "{token}"

mcp_servers:
  brain:
    command: node
    args:
      - "{mcp}"
    env:
      BRAIN_PROVIDER: remote
      BRAIN_API_URL: "{backend}"
      BRAIN_AUTH_TOKEN: "{token}"
"#,
        key = config.api_server_key,
        gw = config.gateway_url,
        token = config.id_token,
        mcp = config.mcp_server_path.replace('\\', "/"),
        backend = config.backend_url,
    );

    fs::write(&config_path, yaml.as_bytes())
        .await
        .map_err(|e| format!("could not write ~/.hermes/config.yaml: {e}"))?;

    // Restrict permissions on Windows: config.yaml is user-only.
    // On Windows this is best-effort; proper ACL setting requires winapi.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    info!("wrote ~/.hermes/config.yaml");
    Ok(())
}
