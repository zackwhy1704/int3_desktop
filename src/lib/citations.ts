/**
 * Citation utilities for verifying claim IDs in agent responses.
 *
 * Citation format (frozen after Gate 3): [claim:N]
 * where N is an integer claim ID from the backend.
 *
 * ## Why this exists (Gate 0 item 2)
 * Hermes is an AI agent — it can paraphrase, drop, or hallucinate claim IDs.
 * Before rendering any citation, the React UI calls POST /v1/validate-claims
 * on the backend. The backend scope-checks each ID. IDs that fail are shown
 * as "unverifiable" rather than silently disappearing or being treated as real.
 *
 * ## Usage (Gate 5)
 * const ids = extractClaimIds(agentResponse);
 * const verified = await validateClaims(ids, backendUrl, authToken);
 * // render with verifiedCitations map — show badge for unverified ones
 */

import type { Claim } from "./brain";

/** Regex that matches [claim:42] — the frozen citation marker. */
const CITATION_RE = /\[claim:(\d+)\]/g;

/** Extract all claim IDs referenced in agent response text. */
export function extractClaimIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(CITATION_RE)) {
    ids.add(match[1]);
  }
  return [...ids];
}

/**
 * Replace citation markers in text with a placeholder for rendering.
 * The placeholder carries the id so the UI component can look it up in
 * the verifiedCitations map.
 *
 * Returns the transformed text (safe to pass to a renderer that processes
 * [cite:N] tokens). Only used by Gate 5 ChatView.
 */
export function markCitations(text: string): string {
  return text.replace(CITATION_RE, "[cite:$1]");
}

export interface ValidationResult {
  /** Claim IDs that exist in the DB and are in the caller's scope. */
  valid: Record<string, Claim>;
  /** IDs that were NOT found or are out of scope — must be flagged in the UI. */
  invalid: string[];
}

/**
 * Validate claim IDs against the backend.
 *
 * Calls POST /v1/validate-claims with the extracted IDs and the user's auth
 * token. The backend scope-checks every ID; IDs that fail are returned in
 * `invalid`. Gate 5 ChatView uses this before rendering any agent response.
 */
export async function validateClaims(
  claimIds: string[],
  baseUrl: string,
  authToken: string
): Promise<ValidationResult> {
  if (claimIds.length === 0) return { valid: {}, invalid: [] };

  const res = await fetch(`${baseUrl}/v1/validate-claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ claim_ids: claimIds }),
  });

  if (!res.ok) {
    // Network/auth failure: treat all IDs as unverifiable rather than crashing.
    console.error(`validate-claims HTTP ${res.status}`);
    return { valid: {}, invalid: claimIds };
  }

  return res.json() as Promise<ValidationResult>;
}
