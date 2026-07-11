import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` never touches a database — schema/out are all it
// needs. `drizzle-kit migrate` does, and targets whichever credentials are
// set: AWS Data API in CI/deploy (RESOURCE_ARN set), local Postgres
// otherwise (DATABASE_URL, e.g. the docker-compose instance used for tests).
const usingDataApi = Boolean(process.env["RESOURCE_ARN"]);

export default usingDataApi
  ? defineConfig({
      dialect: "postgresql",
      schema: "./src/schema.ts",
      out: "./drizzle",
      driver: "aws-data-api",
      dbCredentials: {
        database: process.env["DATABASE_NAME"] ?? "ledger",
        resourceArn: process.env["RESOURCE_ARN"]!,
        secretArn: process.env["SECRET_ARN"]!,
      },
    })
  : defineConfig({
      dialect: "postgresql",
      schema: "./src/schema.ts",
      out: "./drizzle",
      dbCredentials: {
        url:
          process.env["DATABASE_URL"] ??
          "postgres://postgres:postgres@localhost:5432/ledger",
      },
    });
