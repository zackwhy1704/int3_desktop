import { z } from "zod";
import type { BrainProvider } from "../brain/index.ts";

export const getClaimSchema = {
  name: "get_claim",
  description:
    "Retrieve a specific claim by its ID, including full metadata and supersede status. " +
    "Use this when a brain_search result is marked as superseded, or when the user " +
    "asks 'what was the policy before?' or 'has this changed?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      claim_id: {
        type: "string",
        description: "The claim ID returned by brain_search.",
      },
    },
    required: ["claim_id"],
  },
} as const;

export const GetClaimInput = z.object({
  claim_id: z.string().min(1),
});

export async function executeGetClaim(
  provider: BrainProvider,
  rawArgs: unknown
) {
  const { claim_id } = GetClaimInput.parse(rawArgs);
  const claim = await provider.getClaim(claim_id);

  const lines = [
    `Subject:   ${claim.subject}`,
    `Attribute: ${claim.attribute}`,
    `Value:     ${claim.value}`,
    claim.condition ? `Condition: ${claim.condition}` : null,
    `As of:     ${claim.asOf}`,
    `Scope:     ${claim.scope}`,
    claim.supersededBy
      ? `Status:    SUPERSEDED by claim ${claim.supersededBy}`
      : `Status:    CURRENT`,
  ].filter(Boolean);

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
