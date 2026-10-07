import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run agent/mcp tests with Node environment (no browser APIs needed).
    environment: "node",
    include: ["agent/**/*.test.ts"],
    // Snapshot files live next to the test files.
    snapshotOptions: {
      snapshotFormat: { printBasicPrototype: false },
    },
  },
});
