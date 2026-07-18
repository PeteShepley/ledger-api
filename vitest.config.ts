import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Keep test output free of app log lines; override by hand when
    // debugging a failing test via logs.
    env: { LOG_LEVEL: "silent" },
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // All test files share one Postgres instance and truncate tables
    // between tests — parallel test files would race on that.
    fileParallelism: false,
  },
});
