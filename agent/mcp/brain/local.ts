import type { BrainProvider, Claim, SearchResult, Source } from "./provider.ts";

/**
 * LocalBrainProvider — NOT YET IMPLEMENTED.
 *
 * Future capability: routes queries to a local Ollama instance + a locally-
 * synced pgvector database. Enables offline operation and eliminates per-query
 * token costs for clients who opt in.
 *
 * ## When to implement
 * When a customer requests it. Do not implement speculatively.
 *
 * ## Design constraints for the implementer
 * - THE BrainProvider INTERFACE MUST NOT CHANGE. Hermes and MCP tool schemas
 *   are built against it. Changing the interface requires a coordinated release.
 * - Ollama endpoint: http://localhost:11434/v1 (OpenAI-compatible).
 *   Model: a local embed + chat model, e.g. nomic-embed-text + mistral.
 * - Local pgvector: a user-opted-in sync process downloads a scoped snapshot
 *   from the backend. Scope enforcement happens at sync time (server-side).
 *   The client receives only what the server authorised at the last sync.
 * - Sync service lives in a separate module, not here. This file is query-only.
 * - Token savings estimate: document for the customer before they opt in.
 * - Switching: set BRAIN_PROVIDER=local in hermes_config.json. No other change.
 *
 * ## Activation (when implemented)
 * 1. User opts in via a setting in the UI.
 * 2. Tauri triggers a sync: backend → local pgvector (scoped snapshot).
 * 3. hermes_config.json updated: BRAIN_PROVIDER=local.
 * 4. Hermes restarted.
 */
export class LocalBrainProvider implements BrainProvider {
  async search(_query: string, _scopes: string[]): Promise<SearchResult[]> {
    throw new Error(
      "LocalBrainProvider is not yet implemented. Set BRAIN_PROVIDER=remote in hermes_config.json."
    );
  }

  async getClaim(_claimId: string): Promise<Claim> {
    throw new Error(
      "LocalBrainProvider is not yet implemented. Set BRAIN_PROVIDER=remote in hermes_config.json."
    );
  }

  async listSources(_scopes: string[]): Promise<Source[]> {
    throw new Error(
      "LocalBrainProvider is not yet implemented. Set BRAIN_PROVIDER=remote in hermes_config.json."
    );
  }
}
