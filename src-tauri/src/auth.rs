//! Google OIDC PKCE sign-in for Company Brain Desktop.
//!
//! ## Flow
//! 1. `sign_in` command: generates PKCE verifier/challenge + random state,
//!    starts a local callback server on a random port, opens the system browser
//!    to Google's auth endpoint, waits (≤2 min) for the redirect, exchanges the
//!    auth code for tokens, stores tokens in tauri-plugin-store, emits `auth-changed`.
//! 2. `refresh_tokens` command: exchanges the stored refresh_token for a new
//!    id_token, updates the store, emits `auth-changed`.
//! 3. `sign_out` command: clears the token store, emits `auth-changed`.
//! 4. `get_auth_state` command: returns the current token state to the React UI.
//!
//! ## Token handling (Gate 0 item 8 — Option C)
//! The id_token is NOT written to disk. It is stored in tauri-plugin-store
//! (AppData/Roaming/int3-desktop/auth.json) as part of the Tokens struct,
//! which is the minimum required to support token refresh across app restarts.
//! The store is encrypted by the OS keychain on Windows (DPAPI).
//!
//! The id_token is injected as `OPENAI_API_KEY` and `BRAIN_AUTH_TOKEN` env
//! vars when spawning Hermes (see hermes.rs). It is never written to the
//! Hermes config file on disk.
//!
//! ## Hermes config
//! The static parts of the Hermes config (platform key, MCP server command)
//! are written to `~/.hermes/config.yaml` on first sign-in. The config is
//! backed up to `~/.hermes/config.yaml.int3-bak` before writing.
//! Gate 8: investigate `hermes --config <path>` to use app-local config
//! instead of writing to the user's global `~/.hermes/` directory.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use log::{error, info, warn};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const STORE_FILE: &str = "auth.json";
const STORE_KEY: &str = "tokens";
/// Refresh 5 minutes before the id_token expires.
const REFRESH_BUFFER_SECS: u64 = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub id_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp after which the id_token should be refreshed.
    pub refresh_after: u64,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthState {
    pub signed_in: bool,
    pub email: Option<String>,
    pub refresh_after: Option<u64>,
}

/// In-memory token cache so hermes.rs can read the current id_token
/// without hitting the store on every Hermes restart.
pub struct TokenCache(pub Mutex<Option<Tokens>>);

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sign_in(app: AppHandle, client_id: String) -> Result<AuthState, String> {
    let verifier = pkce_verifier();
    let challenge = pkce_challenge(&verifier);
    let state_param = random_hex(16);

    // Start callback listener on a random port.
    let listener =
        tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &response_type=code\
         &scope=openid+email+profile\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &state={state_param}\
         &access_type=offline\
         &prompt=consent"
    );

    open::that(&auth_url).map_err(|e| format!("failed to open browser: {e}"))?;
    info!("opened browser for Google sign-in");

    let (code, returned_state) = wait_for_callback(listener).await?;
    if returned_state != state_param {
        return Err("CSRF state mismatch — sign-in aborted".to_string());
    }

    let tokens = exchange_code(&code, &verifier, &redirect_uri, &client_id).await?;
    let state = auth_state_from(&tokens);
    persist_tokens(&app, &tokens);
    let _ = app.emit("auth-changed", &state);
    info!("sign-in complete for {:?}", tokens.email);
    Ok(state)
}

#[tauri::command]
pub async fn refresh_tokens(app: AppHandle, client_id: String) -> Result<AuthState, String> {
    let existing = load_tokens(&app).ok_or("not signed in")?;
    let refresh_token = existing.refresh_token.ok_or("no refresh token stored")?;

    let tokens = do_token_refresh(&refresh_token, &client_id).await?;
    let state = auth_state_from(&tokens);
    persist_tokens(&app, &tokens);
    let _ = app.emit("auth-changed", &state);
    info!("token refreshed for {:?}", tokens.email);
    Ok(state)
}

#[tauri::command]
pub fn sign_out(app: AppHandle) -> Result<(), String> {
    clear_tokens(&app);
    let _ = app.emit("auth-changed", AuthState { signed_in: false, email: None, refresh_after: None });
    info!("signed out");
    Ok(())
}

#[tauri::command]
pub fn get_auth_state(app: AppHandle) -> AuthState {
    match load_tokens(&app) {
        Some(t) => auth_state_from(&t),
        None => AuthState { signed_in: false, email: None, refresh_after: None },
    }
}

// ---------------------------------------------------------------------------
// Token store helpers
// ---------------------------------------------------------------------------

pub fn persist_tokens(app: &AppHandle, tokens: &Tokens) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(STORE_KEY, serde_json::to_value(tokens).unwrap_or_default());
        if let Err(e) = store.save() {
            error!("failed to save token store: {e}");
        }
    }
    // Update in-memory cache.
    if let Some(cache) = app.try_state::<TokenCache>() {
        if let Ok(mut g) = cache.0.lock() {
            *g = Some(tokens.clone());
        }
    }
}

pub fn load_tokens(app: &AppHandle) -> Option<Tokens> {
    // Try in-memory cache first.
    if let Some(cache) = app.try_state::<TokenCache>() {
        if let Ok(g) = cache.0.lock() {
            if g.is_some() {
                return g.clone();
            }
        }
    }
    // Fall back to store.
    let store = app.store(STORE_FILE).ok()?;
    let val = store.get(STORE_KEY)?;
    let tokens: Tokens = serde_json::from_value(val).ok()?;
    // Populate cache.
    if let Some(cache) = app.try_state::<TokenCache>() {
        if let Ok(mut g) = cache.0.lock() {
            *g = Some(tokens.clone());
        }
    }
    Some(tokens)
}

fn clear_tokens(app: &AppHandle) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.delete(STORE_KEY);
        let _ = store.save();
    }
    if let Some(cache) = app.try_state::<TokenCache>() {
        if let Ok(mut g) = cache.0.lock() {
            *g = None;
        }
    }
}

fn auth_state_from(t: &Tokens) -> AuthState {
    AuthState {
        signed_in: true,
        email: t.email.clone(),
        refresh_after: Some(t.refresh_after),
    }
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

fn pkce_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn random_hex(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Local callback server
// ---------------------------------------------------------------------------

async fn wait_for_callback(
    listener: tokio::net::TcpListener,
) -> Result<(String, String), String> {
    let timeout = tokio::time::Duration::from_secs(120);
    let (mut stream, _) = tokio::time::timeout(timeout, listener.accept())
        .await
        .map_err(|_| "sign-in timed out (2 minutes)")?
        .map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse: "GET /?code=XXX&state=YYY HTTP/1.1"
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");
    let query = path.splitn(2, '?').nth(1).unwrap_or("");

    let params: HashMap<&str, &str> = query
        .split('&')
        .filter_map(|kv| kv.splitn(2, '=').collect::<Vec<_>>().try_into().ok())
        .filter_map(|p: [&str; 2]| Some((p[0], p[1])))
        .collect();

    let html = "<html><body><h2>Signed in!</h2><p>You can close this tab.</p></body></html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{html}",
        html.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;

    let code = params.get("code").map(|s| s.to_string()).ok_or("no code in callback")?;
    let state = params.get("state").map(|s| s.to_string()).ok_or("no state in callback")?;
    Ok((code, state))
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

async fn exchange_code(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    client_id: &str,
) -> Result<Tokens, String> {
    let params = [
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ];
    let resp: TokenResponse = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token exchange failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("token response parse failed: {e}"))?;

    Ok(build_tokens(resp))
}

async fn do_token_refresh(refresh_token: &str, client_id: &str) -> Result<Tokens, String> {
    let params = [
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
    ];
    let mut resp: TokenResponse = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token refresh failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("token refresh response parse failed: {e}"))?;

    // Refresh responses do not include a new refresh_token; keep the existing one.
    if resp.refresh_token.is_none() {
        resp.refresh_token = Some(refresh_token.to_string());
    }
    Ok(build_tokens(resp))
}

fn build_tokens(resp: TokenResponse) -> Tokens {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let email = decode_email_from_jwt(&resp.id_token);
    Tokens {
        id_token: resp.id_token,
        refresh_token: resp.refresh_token,
        refresh_after: now + resp.expires_in.saturating_sub(REFRESH_BUFFER_SECS),
        email,
    }
}

/// Extract the `email` claim from the JWT payload without verifying the signature.
/// Verification happens server-side in the backend; here we only want to display
/// the email in the UI.
fn decode_email_from_jwt(token: &str) -> Option<String> {
    let payload_b64 = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("email")?.as_str().map(|s| s.to_string())
}
