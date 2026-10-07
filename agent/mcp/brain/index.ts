import type { BrainProvider } from "./provider";
import { RemoteBrainProvider } from "./remote";
import { LocalBrainProvider } from "./local";

export type { BrainProvider, SearchResult, Claim, Source } from "./provider";

/**
 * Factory — reads BRAIN_PROVIDER env and returns the correct implementation.
 *
 * BRAIN_PROVIDER=remote  (default) → RemoteBrainProvider → int3_ai backend
 * BRAIN_PROVIDER=local             → LocalBrainProvider  → local Ollama + pgvector
 *
 * The env is set in hermes_config.json and injected by Hermes when it spawns
 * the MCP server process. No code outside this file needs to know which
 * provider is active.
 */
export function createBrainProvider(): BrainProvider {
  const mode = process.env.BRAIN_PROVIDER ?? "remote";

  if (mode === "local") {
    return new LocalBrainProvider();
  }

  const baseUrl = process.env.BRAIN_API_URL;
  if (!baseUrl) {
    throw new Error(
      "BRAIN_API_URL env var is required when BRAIN_PROVIDER=remote. " +
      "Check hermes_config.json."
    );
  }

  const token = process.env.BRAIN_AUTH_TOKEN ?? "";
  return new RemoteBrainProvider(baseUrl, token);
}
