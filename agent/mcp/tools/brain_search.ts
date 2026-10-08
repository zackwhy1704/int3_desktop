import { z } from "zod";
import type { BrainProvider } from "../brain/index";

/**
 * Citation format (FROZEN after Gate 3):
 *   [claim:N]  where N is the integer claim ID returned by the backend.
 *
 * Every result carries this marker. The model MUST reproduce it verbatim
 * when it uses the fact in its answer so the React UI can verify it
 * server-side before rendering. Hallucinated IDs fail /v1/validate-claims
 * and are shown as unverifiable citations.
 */
export const CITATION_FORMAT = "[claim:{id}]";

/** MCP tool definition — registered with Hermes at server startup. */
export const brainSearchSchema = {
  name: "brain_search",
  description:
    "Search the company brain for information relevant to a question. " +
    "Returns matching claims with source titles, dates, and claim IDs. " +
    "Always call this tool before answering any question about company policy, " +
    "people, processes, or facts. " +
    "When you use a result in your answer you MUST include its citation marker " +
    "exactly as shown (e.g. [claim:42]) so the user can verify it. " +
    "Do not invent claim IDs — only cite IDs returned by this tool.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The question or keywords to search for.",
      },
      scopes: {
        type: "array",
        items: { type: "string" },
        description:
          "Permission scopes to restrict the search to (e.g. 'finance', 'operations'). " +
          "Omit or pass [] to search all scopes the user can access.",
      },
    },
    required: ["query"],
  },
} as const;

export const BrainSearchInput = z.object({
  query: z.string().min(1, "query must not be empty"),
  scopes: z.array(z.string()).optional().default([]),
});

export async function executeBrainSearch(
  provider: BrainProvider,
  rawArgs: unknown
) {
  const input = BrainSearchInput.parse(rawArgs);
  const results = await provider.search(input.query, input.scopes);

  if (results.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "No relevant information found in the company brain for this query. Do not fabricate an answer — tell the user no source was found and suggest they contact the relevant team.",
        },
      ],
    };
  }

  const formatted = results
    .map((r, i) => {
      const supersededNote = r.supersededBy
        ? `\n  ⚠ SUPERSEDED — use get_claim to see current value. Cite [claim:${r.supersededBy}] instead.`
        : "";
      return (
        `[${i + 1}] ${r.sourceTitle} (${r.asOf}) [claim:${r.claimId}]\n` +
        `  ${r.content}${supersededNote}`
      );
    })
    .join("\n\n");

  return { content: [{ type: "text" as const, text: formatted }] };
}
