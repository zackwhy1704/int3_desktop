import { z } from "zod";
import type { BrainProvider } from "../brain/index.ts";

export const listSourcesSchema = {
  name: "list_sources",
  description:
    "List document sources the current user can access. " +
    "Use this to understand what knowledge is available before searching, " +
    "or when the user asks 'what documents do you have?' or 'what do you know about X area?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      scopes: {
        type: "array",
        items: { type: "string" },
        description: "Filter to specific scopes. Omit for all accessible sources.",
      },
    },
    required: [],
  },
} as const;

export const ListSourcesInput = z.object({
  scopes: z.array(z.string()).optional().default([]),
});

export async function executeListSources(
  provider: BrainProvider,
  rawArgs: unknown
) {
  const input = ListSourcesInput.parse(rawArgs);
  const sources = await provider.listSources(input.scopes);

  if (sources.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "No sources accessible in the given scopes.",
        },
      ],
    };
  }

  const lines = sources.map(
    (s) => `• [${s.scope}] ${s.title}  (${s.kind}, last updated ${s.updatedAt})`
  );

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
