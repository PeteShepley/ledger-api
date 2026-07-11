import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle as drizzleDataApi } from "drizzle-orm/aws-data-api/pg";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Database =
  | ReturnType<typeof drizzleDataApi<typeof schema>>
  | ReturnType<typeof drizzleNodePostgres<typeof schema>>;

// Two drivers, one schema. In the deployed Lambda, RESOURCE_ARN/SECRET_ARN
// are set and this talks to Aurora Serverless v2 over the RDS Data API —
// no VPC attachment, plain HTTPS. In tests, DATABASE_URL points at a real
// local Postgres instead, since Data API has no offline mock (see
// design.md's "Testing tradeoff" section for why this split exists and
// what it doesn't cover).
let cached: Database | undefined;

export function getDb(): Database {
  if (cached) return cached;

  const resourceArn = process.env["RESOURCE_ARN"];
  const secretArn = process.env["SECRET_ARN"];

  if (resourceArn && secretArn) {
    cached = drizzleDataApi({
      client: new RDSDataClient({}),
      database: process.env["DATABASE_NAME"] ?? "ledger",
      secretArn,
      resourceArn,
      schema,
    });
    return cached;
  }

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "Set RESOURCE_ARN + SECRET_ARN (Data API) or DATABASE_URL (local Postgres) before calling getDb().",
    );
  }

  cached = drizzleNodePostgres({
    client: new Pool({ connectionString }),
    schema,
  });
  return cached;
}
