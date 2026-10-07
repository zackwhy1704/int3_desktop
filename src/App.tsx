// Gate 1: minimal status UI — confirms Hermes sidecar is running.
// Replace with full chat interface at Gate 5.

import { useEffect, useState } from "react";
import { checkHermesHealth } from "./lib/hermes";

type Status = "checking" | "connected" | "disconnected";

export default function App() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const check = async () => {
      const healthy = await checkHermesHealth();
      setStatus(healthy ? "connected" : "disconnected");
    };

    check();
    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 32, fontFamily: "system-ui", maxWidth: 480 }}>
      <h1 style={{ marginBottom: 8 }}>Company Brain</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Your company's knowledge, always at hand.
      </p>

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

      {/* TODO Gate 5: replace above with <ChatView /> */}
      {/* TODO Gate 4: add <SignInView /> when no OIDC token present */}
    </div>
  );
}
