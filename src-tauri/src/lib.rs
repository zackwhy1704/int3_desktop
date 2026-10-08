mod auth;
mod hermes;

use auth::TokenCache;
use log::info;
use std::sync::Mutex;

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(TokenCache(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            auth::sign_in,
            auth::refresh_tokens,
            auth::sign_out,
            auth::get_auth_state,
        ])
        .setup(|app| {
            // If the user was previously signed in, try to spawn Hermes immediately.
            // The React UI will handle refresh if the token is expired.
            if let Some(tokens) = auth::load_tokens(app.handle()) {
                info!("found stored tokens for {:?}, spawning Hermes", tokens.email);
                // Gate 4: read BACKEND_URL and GATEWAY_URL from app config or env.
                // For the pilot these are hardcoded; Gate 6 adds a settings UI.
                let backend_url = std::env::var("INT3_BACKEND_URL")
                    .unwrap_or_else(|_| "https://api.int3.ai".to_string());
                let gateway_url = std::env::var("INT3_GATEWAY_URL")
                    .unwrap_or_else(|_| "https://gw.int3.ai".to_string());
                let mcp_path = std::env::var("INT3_MCP_SERVER_PATH")
                    .unwrap_or_else(|_| "agent/mcp/server.js".to_string());
                let api_key = generate_api_server_key();

                let config = hermes::HermesConfig {
                    id_token: tokens.id_token,
                    gateway_url,
                    backend_url,
                    mcp_server_path: mcp_path,
                    api_server_key: api_key,
                };
                hermes::spawn(app.handle(), config)?;
            } else {
                info!("no stored tokens — waiting for sign-in");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                hermes::stop(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn generate_api_server_key() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
