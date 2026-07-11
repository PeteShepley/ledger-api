import { sql } from "drizzle-orm";
import { beforeEach } from "vitest";

import { getDb } from "../src/db.js";

beforeEach(async () => {
  await getDb().execute(sql`TRUNCATE TABLE entries, transactions, accounts RESTART IDENTITY CASCADE`);
});
