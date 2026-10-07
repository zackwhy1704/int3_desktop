/**
 * Brain MCP server — entry point.
 *
 * Hermes Agent spawns this as a stdio child process and registers its tools.
 * Hermes calls tools via the MCP protocol; this server routes each call to
 * the appropriate BrainProvider method.
 *
 * To run in development (without Hermes):
 *   npm run agent:dev
 *
 * To build for bundling:
 *   npm run agent:build  →  dist-agent/mcp/server.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createBrainProvider } from "./brain/index";
import {
  brainSearchSchema,
  executeBrainSearch,
} from "./tools/brain_search";
import { getClaimSchema, executeGetClaim } from "./tools/get_claim";
import {
  listSourcesSchema,
  executeListSources,
} from "./tools/list_sources";

const provider = createBrainProvider();

const server = new Server(
  { name: "brain-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [brainSearchSchema, getClaimSchema, listSourcesSchema],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "brain_search") return await executeBrainSearch(provider, args);
    if (name === "get_claim")    return await executeGetClaim(provider, args);
    if (name === "list_sources") return await executeListSources(provider, args);

    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Tool error (${name}): ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
