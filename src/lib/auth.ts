/**
 * Auth hook — wraps Tauri invoke commands for OIDC sign-in/out.
 *
 * Gate 4: Google OIDC PKCE flow implemented in src-tauri/src/auth.rs.
 * The id_token is stored in tauri-plugin-store (AppData, OS-encrypted).
 * It is never exposed to the React layer — the React layer only sees
 * { signedIn, email, refreshAfter }.
 *
 * Gate 5: after sign-in, the chat UI calls Hermes via src/lib/hermes.ts
 * using the Hermes local API key (emitted as `hermes-ready` payload).
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AuthState {
  signedIn: boolean;
  email: string | null;
  /** Unix timestamp after which the token should be refreshed (null if not signed in). */
  refreshAfter: number | null;
}

export interface UseAuthReturn {
  auth: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Call when refreshAfter has passed — exchanges refresh_token for new id_token. */
  refreshToken: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function mapState(raw: { signed_in: boolean; email: string | null; refresh_after: number | null }): AuthState {
  return {
    signedIn: raw.signed_in,
    email: raw.email,
    refreshAfter: raw.refresh_after,
  };
}

export function useAuth(): UseAuthReturn {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null, refreshAfter: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial auth state from Rust.
  useEffect(() => {
    invoke<ReturnType<typeof mapState>["signedIn"] extends boolean ? Parameters<typeof mapState>[0] : never>("get_auth_state")
      .then((raw) => setAuth(mapState(raw as Parameters<typeof mapState>[0])))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Listen for auth-changed events from Rust (after sign-in / refresh / sign-out).
  useEffect(() => {
    const unlisten = listen<Parameters<typeof mapState>[0]>("auth-changed", (event) => {
      setAuth(mapState(event.payload));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Auto-refresh token before it expires.
  useEffect(() => {
    if (!auth.signedIn || !auth.refreshAfter) return;
    const msUntilRefresh = auth.refreshAfter * 1000 - Date.now();
    if (msUntilRefresh <= 0) {
      refreshToken();
      return;
    }
    const timer = setTimeout(() => refreshToken(), msUntilRefresh);
    return () => clearTimeout(timer);
  }, [auth.signedIn, auth.refreshAfter]);

  const signIn = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError("VITE_GOOGLE_CLIENT_ID is not set — cannot sign in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<Parameters<typeof mapState>[0]>("sign_in", {
        clientId: GOOGLE_CLIENT_ID,
      });
      setAuth(mapState(raw));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshToken = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) return;
    try {
      const raw = await invoke<Parameters<typeof mapState>[0]>("refresh_tokens", {
        clientId: GOOGLE_CLIENT_ID,
      });
      setAuth(mapState(raw));
    } catch (e) {
      // If refresh fails, require re-sign-in.
      setAuth({ signedIn: false, email: null, refreshAfter: null });
      setError("Session expired — please sign in again");
    }
  }, []);

  const signOut = useCallback(async () => {
    await invoke("sign_out").catch(() => {});
    setAuth({ signedIn: false, email: null, refreshAfter: null });
  }, []);

  return { auth, signIn, signOut, refreshToken, loading, error };
}
