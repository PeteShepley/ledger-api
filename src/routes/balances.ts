import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { getDb } from "../db.js";
import { computeAllBalances, today } from "../lib/ledger.js";
import { json } from "../lib/response.js";
import { asOfQuerySchema } from "../lib/validation.js";

const app = new Hono();

app.get("/", zValidator("query", asOfQuerySchema), async (c) => {
  const asOf = c.req.valid("query").as_of ?? today();
  const balances = await computeAllBalances(getDb(), asOf);
  return json(c, { as_of: asOf, accounts: balances });
});

export default app;
