/**
 * Re-export backend types used by the React layer.
 * Mirrors agent/mcp/brain/provider.ts — kept in sync manually.
 * Gate 5: generate from backend OpenAPI spec instead.
 */
export type { Claim, SearchResult, Source } from "../../agent/mcp/brain/provider";
