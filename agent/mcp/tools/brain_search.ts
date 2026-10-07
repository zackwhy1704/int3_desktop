import { z } from "zod";
import type { BrainProvider } from "../brain/index.ts";

/** MCP tool definition — registered with Hermes at server startup. */
export const brainSearchSchema = {
  name: "brain_search",
  description:
    "Search the company brain for information relevant to a question. " +
    "Returns matching claims with source titles, dates, and claim IDs. " +
    "Always call this tool before answering any question about company policy, " +
    "people, processes, or facts. If results are returned, base your answer " +
    "exclusively on them and cite each one.",
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
        ? `\n  ⚠ This claim has been superseded — use get_claim(${r.claimId}) for full history.`
        : "";
      return (
        `[${i + 1}] ${r.sourceTitle} (${r.asOf})\n` +
        `  ${r.content}\n` +
        `  claim_id: ${r.claimId}${supersededNote}`
      );
    })
    .join("\n\n");

  return { content: [{ type: "text" as const, text: formatted }] };
}
