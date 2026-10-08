// Gate 1: minimal status UI — confirms Hermes is running.
// Gate 4: auth gate — shows SignInView if not signed in.
// Replace status section with full chat interface at Gate 5.

import { useEffect, useState } from "react";
import { checkHermesHealth } from "./lib/hermes";
import { useAuth } from "./lib/auth";

type Status = "checking" | "connected" | "disconnected";

function SignInView({
  onSignIn,
  loading,
  error,
}: {
  onSignIn: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div style={{ padding: 32, fontFamily: "system-ui", maxWidth: 480 }}>
      <h1 style={{ marginBottom: 8 }}>Company Brain</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Your company's knowledge, always at hand.
      </p>

      <button
        onClick={onSignIn}
        disabled={loading}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 20px",
          borderRadius: 8,
          border: "1px solid #d1d5db",
          background: loading ? "#f3f4f6" : "#fff",
          cursor: loading ? "default" : "pointer",
          fontSize: 15,
          fontWeight: 500,
          color: "#111",
          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        {loading ? "Opening browser…" : "Sign in with Google"}
      </button>

      {error && (
        <p style={{ marginTop: 16, color: "#dc2626", fontSize: 13 }}>{error}</p>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: "#9ca3af" }}>
        By signing in you agree to your organization's usage policies.
      </p>
    </div>
  );
}

export default function App() {
  const { auth, signIn, loading: authLoading, error: authError } = useAuth();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!auth.signedIn) return;

    const check = async () => {
      const healthy = await checkHermesHealth();
      setStatus(healthy ? "connected" : "disconnected");
    };

    check();
    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, [auth.signedIn]);

  // Show loading spinner while checking stored auth state.
  if (authLoading) {
    return (
      <div style={{ padding: 32, fontFamily: "system-ui" }}>
        <p style={{ color: "#9ca3af" }}>Loading…</p>
      </div>
    );
  }

  if (!auth.signedIn) {
    return <SignInView onSignIn={signIn} loading={authLoading} error={authError} />;
  }

  return (
    <div style={{ padding: 32, fontFamily: "system-ui", maxWidth: 480 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Company Brain</h1>
          <p style={{ color: "#666", fontSize: 13, margin: 0 }}>
            {auth.email ?? "Signed in"}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderRadius: 8,
          background: status === "connected" ? "#f0fdf4" : status === "disconnected" ? "#fef2f2" : "#f8fafc",
          border: `1px solid ${status === "connected" ? "#bbf7d0" : status === "disconnected" ? "#fecaca" : "#e2e8f0"}`,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: status === "connected" ? "#22c55e" : status === "disconnected" ? "#ef4444" : "#94a3b8",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14 }}>
          {status === "checking" && "Starting agent…"}
          {status === "connected" && "Agent ready"}
          {status === "disconnected" && "Agent starting — please wait…"}
        </span>
      </div>

      {/* TODO Gate 5: replace above status section with <ChatView /> */}
    </div>
  );
}
