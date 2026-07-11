import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // All test files share one Postgres instance and truncate tables
    // between tests — parallel test files would race on that.
    fileParallelism: false,
  },
});
