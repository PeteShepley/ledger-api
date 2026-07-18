import { Hono } from "hono";

import { ApiError } from "./lib/errors.js";
import type { AppEnv } from "./lib/logger.js";
import { requestLogger } from "./lib/request-logger.js";
import accounts from "./routes/accounts.js";
import balances from "./routes/balances.js";
import transactions from "./routes/transactions.js";

export const app = new Hono<AppEnv>();

app.use("*", requestLogger);

app.route("/accounts", accounts);
app.route("/transactions", transactions);
app.route("/balances", balances);

// Logging for both the error and generic-500 cases is centralized in
// requestLogger (it reads c.error after next() resolves) — this only
// shapes the response body.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status);
  }
  return c.json({ error: "internal server error" }, 500);
});
