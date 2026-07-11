// `drizzle-kit migrate`'s CLI silently fails (exits 1, prints nothing
// useful) against the aws-data-api driver — confirmed by reproducing it
// locally and comparing against calling drizzle-orm's migrator directly,
// which works. This script does the same direct call `drizzle-kit
// migrate` should have, for both drivers. `drizzle-kit generate` (schema
// diffing, no DB connection) is unaffected and still used as-is.
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle as drizzleDataApi } from "drizzle-orm/aws-data-api/pg";
import { migrate as migrateDataApi } from "drizzle-orm/aws-data-api/pg/migrator";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const resourceArn = process.env.RESOURCE_ARN;
const secretArn = process.env.SECRET_ARN;

if (resourceArn && secretArn) {
  const db = drizzleDataApi({
    client: new RDSDataClient({}),
    database: process.env.DATABASE_NAME ?? "ledger",
    secretArn,
    resourceArn,
  });
  await migrateDataApi(db, { migrationsFolder: "./drizzle" });
} else {
  const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ledger";
  const pool = new Pool({ connectionString });
  await migrateNodePostgres(drizzleNodePostgres({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
}

console.log("Migrations applied.");
