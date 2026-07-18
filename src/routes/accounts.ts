import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db.js";
import { computeBalance, getAccountOrThrow, today } from "../lib/ledger.js";
import type { AppEnv } from "../lib/logger.js";
import { json } from "../lib/response.js";
import {
  asOfQuerySchema,
  createAccountSchema,
  paginationQuerySchema,
  zIdParam,
  zJson,
} from "../lib/validation.js";
import { accounts, entries } from "../schema.js";

const app = new Hono<AppEnv>();

app.post("/", zJson(createAccountSchema), async (c) => {
  const db = getDb();
  const [account] = await db
    .insert(accounts)
    .values(c.req.valid("json"))
    .returning();
  c.get("logger").info(
    { account_id: account!.id, type: account!.type },
    "account created",
  );
  return json(c, account, 201);
});

app.get("/", async (c) => {
  const db = getDb();
  const rows = await db.select().from(accounts);
  return json(c, rows);
});

app.get("/:id", zIdParam, async (c) => {
  const db = getDb();
  const account = await getAccountOrThrow(db, c.req.valid("param").id);
  return json(c, account);
});

app.get(
  "/:id/balance",
  zIdParam,
  zValidator("query", asOfQuerySchema),
  async (c) => {
    const db = getDb();
    const account = await getAccountOrThrow(db, c.req.valid("param").id);
    const asOf = c.req.valid("query").as_of ?? today();
    const balance = await computeBalance(db, account.id, asOf);
    c.get("logger").debug(
      { account_id: account.id, as_of: asOf },
      "computed balance",
    );
    return json(c, { account_id: account.id, as_of: asOf, balance });
  },
);

app.get(
  "/:id/entries",
  zIdParam,
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const db = getDb();
    const account = await getAccountOrThrow(db, c.req.valid("param").id);
    const { limit, offset } = c.req.valid("query");
    const rows = await db
      .select()
      .from(entries)
      .where(eq(entries.accountId, account.id))
      .orderBy(desc(entries.effectiveDate), desc(entries.createdAt))
      .limit(limit)
      .offset(offset);
    c.get("logger").debug(
      { account_id: account.id, limit, offset },
      "listed entries",
    );
    return json(c, { items: rows, limit, offset });
  },
);

export default app;
