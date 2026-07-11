import { Hono } from "hono";

import { ApiError } from "./lib/errors.js";
import accounts from "./routes/accounts.js";
import balances from "./routes/balances.js";
import transactions from "./routes/transactions.js";

export const app = new Hono();

app.route("/accounts", accounts);
app.route("/transactions", transactions);
app.route("/balances", balances);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});
