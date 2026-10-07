/**
 * BrainProvider — the stable abstraction between Hermes MCP tools and the
 * backend (remote today, local Ollama + pgvector in future).
 *
 * THIS INTERFACE IS FROZEN AFTER GATE 3.
 * Any change to method signatures or types is a breaking change — it will
 * break Hermes tool schemas and requires a coordinated release.
 */

export interface SearchResult {
  claimId: string;
  content: string;
  sourceTitle: string;
  sourceId: string;
  /** Similarity score, 0–1 */
  score: number;
  /** ISO 8601 date — when this claim was recorded */
  asOf: string;
  /** Present if this claim has been superseded */
  supersededBy?: string;
}

export interface Claim {
  id: string;
  subject: string;
  attribute: string;
  value: string;
  condition: string | null;
  /** ISO 8601 date */
  asOf: string;
  /** null means this is the current claim */
  supersededBy: string | null;
  sourceId: string;
  scope: string;
}

export interface Source {
  id: string;
  title: string;
  /** e.g. "gdrive", "gmail", "manual_upload" */
  kind: string;
  scope: string;
  updatedAt: string;
}

export interface BrainProvider {
  /**
   * Full-text + semantic search over claims the caller is authorised to see.
   * Scopes are enforced server-side — passing an empty array returns results
   * for all scopes the authenticated user belongs to.
   */
  search(query: string, scopes: string[]): Promise<SearchResult[]>;

  /**
   * Retrieve a single claim by ID, including supersede chain context.
   */
  getClaim(claimId: string): Promise<Claim>;

  /**
   * List document sources accessible in the given scopes.
   */
  listSources(scopes: string[]): Promise<Source[]>;
}
