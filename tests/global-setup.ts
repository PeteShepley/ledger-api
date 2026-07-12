import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Runs once before the whole test run — applies every migration in
// drizzle/ to whatever local Postgres DATABASE_URL points at (the CI
// service container, or a scratch instance locally). Production migrations
// (against the RDS Data API) are a separate step in deploy.yml, not this.
export default async function setup() {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://postgres:postgres@localhost:5432/ledger";
  const pool = new Pool({ connectionString });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
}
