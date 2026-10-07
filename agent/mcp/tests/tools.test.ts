/**
 * MCP tool unit tests.
 *
 * Per engineering standards:
 * - Tool formatters are tested as pure functions.
 * - The tool schema list is snapshotted — any change is a visible, reviewed diff
 *   (schemas are a contract; Hermes and the backend both depend on them).
 * - Uses a fake BrainProvider; never touches the network.
 *
 * Run: vitest run agent/mcp/tests/tools.test.ts
 */

import { describe, it, expect } from "vitest";
import type { BrainProvider, SearchResult, Claim, Source } from "../brain/provider";
import { executeBrainSearch, brainSearchSchema } from "../tools/brain_search";
import { executeGetClaim, getClaimSchema } from "../tools/get_claim";
import { executeListSources, listSourcesSchema } from "../tools/list_sources";

// ---------------------------------------------------------------------------
// Schema snapshot — any change here is a breaking contract change.
// ---------------------------------------------------------------------------

describe("tool schema snapshot", () => {
  it("brain_search schema is stable", () => {
    expect(brainSearchSchema).toMatchSnapshot();
  });

  it("get_claim schema is stable", () => {
    expect(getClaimSchema).toMatchSnapshot();
  });

  it("list_sources schema is stable", () => {
    expect(listSourcesSchema).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Fake BrainProvider
// ---------------------------------------------------------------------------

const FAKE_RESULT: SearchResult = {
  claimId: "claim_001",
  content: "The refund window is 30 days.",
  sourceTitle: "Refund Policy v2",
  sourceId: "src_001",
  score: 0.92,
  asOf: "2026-01-15",
};

const FAKE_CLAIM: Claim = {
  id: "claim_001",
  subject: "refund_policy",
  attribute: "window_days",
  value: "30",
  condition: null,
  asOf: "2026-01-15",
  supersededBy: null,
  sourceId: "src_001",
  scope: "company-wide",
};

const FAKE_SOURCE: Source = {
  id: "src_001",
  title: "Refund Policy v2",
  kind: "manual_upload",
  scope: "company-wide",
  updatedAt: "2026-01-15",
};

function makeFakeProvider(overrides?: Partial<BrainProvider>): BrainProvider {
  return {
    search: async () => [FAKE_RESULT],
    getClaim: async () => FAKE_CLAIM,
    listSources: async () => [FAKE_SOURCE],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// brain_search
// ---------------------------------------------------------------------------

describe("executeBrainSearch", () => {
  it("returns formatted result text on success", async () => {
    const result = await executeBrainSearch(makeFakeProvider(), { query: "refund", scopes: [] });
    const text = result.content[0].text;
    expect(text).toContain("Refund Policy v2");
    expect(text).toContain("2026-01-15");
    expect(text).toContain("claim_001");
  });

  it("returns no-source message when results are empty", async () => {
    const provider = makeFakeProvider({ search: async () => [] });
    const result = await executeBrainSearch(provider, { query: "unknown", scopes: [] });
    expect(result.content[0].text).toMatch(/no relevant/i);
  });

  it("flags superseded results with a warning", async () => {
    const superseded = { ...FAKE_RESULT, supersededBy: "claim_002" };
    const provider = makeFakeProvider({ search: async () => [superseded] });
    const result = await executeBrainSearch(provider, { query: "refund", scopes: [] });
    expect(result.content[0].text).toContain("superseded");
  });

  it("rejects empty query", async () => {
    await expect(
      executeBrainSearch(makeFakeProvider(), { query: "", scopes: [] })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// get_claim
// ---------------------------------------------------------------------------

describe("executeGetClaim", () => {
  it("formats current claim correctly", async () => {
    const result = await executeGetClaim(makeFakeProvider(), { claim_id: "claim_001" });
    const text = result.content[0].text;
    expect(text).toContain("refund_policy");
    expect(text).toContain("30");
    expect(text).toContain("CURRENT");
  });

  it("shows SUPERSEDED when claim has been replaced", async () => {
    const superseded = { ...FAKE_CLAIM, supersededBy: "claim_002" };
    const provider = makeFakeProvider({ getClaim: async () => superseded });
    const result = await executeGetClaim(provider, { claim_id: "claim_001" });
    expect(result.content[0].text).toContain("SUPERSEDED");
    expect(result.content[0].text).toContain("claim_002");
  });

  it("includes condition when present", async () => {
    const conditional = { ...FAKE_CLAIM, condition: "enterprise customers only" };
    const provider = makeFakeProvider({ getClaim: async () => conditional });
    const result = await executeGetClaim(provider, { claim_id: "claim_001" });
    expect(result.content[0].text).toContain("enterprise customers only");
  });
});

// ---------------------------------------------------------------------------
// list_sources
// ---------------------------------------------------------------------------

describe("executeListSources", () => {
  it("lists sources with scope and kind", async () => {
    const result = await executeListSources(makeFakeProvider(), { scopes: [] });
    const text = result.content[0].text;
    expect(text).toContain("Refund Policy v2");
    expect(text).toContain("company-wide");
    expect(text).toContain("manual_upload");
  });

  it("returns empty message when no sources exist", async () => {
    const provider = makeFakeProvider({ listSources: async () => [] });
    const result = await executeListSources(provider, { scopes: [] });
    expect(result.content[0].text).toMatch(/no sources/i);
  });
});
