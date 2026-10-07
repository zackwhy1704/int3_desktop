/**
 * Hermes HTTP client.
 *
 * Hermes runs as a sidecar at http://127.0.0.1:8642 (OpenAI-compatible API).
 * This module is the only place in the React UI that speaks directly to Hermes.
 *
 * Gate 1: health check only.
 * Gate 4: setHermesToken() wired after OIDC sign-in.
 * Gate 5: chat() + streamChat() used by ChatView.
 */

const HERMES_BASE = "http://127.0.0.1:8642";

// Set after OIDC sign-in (Gate 4). Hermes validates this token before
// forwarding requests to the gateway.
let _hermesToken: string | null = null;

export function setHermesToken(token: string): void {
  _hermesToken = token;
}

export function clearHermesToken(): void {
  _hermesToken = null;
}

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (_hermesToken) h["Authorization"] = `Bearer ${_hermesToken}`;
  return h;
}

/** Returns true if Hermes is up and responding. */
export async function checkHermesHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${HERMES_BASE}/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Sends a chat request to Hermes (non-streaming).
 * Hermes will call MCP tools (brain_search etc.) as needed and return the final answer.
 */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${HERMES_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Hermes error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

/**
 * Sends a chat request to Hermes with streaming.
 * Calls onChunk with each text delta as it arrives.
 * Returns the full concatenated response.
 */
export async function streamChat(
  messages: ChatMessage[],
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${HERMES_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Hermes error ${res.status}: ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const chunk = JSON.parse(line.slice(6)) as {
          choices: Array<{ delta: { content?: string } }>;
        };
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) { full += delta; onChunk(delta); }
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }

  return full;
}
