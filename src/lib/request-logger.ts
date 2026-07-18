import type { Context, Next } from "hono";

import { ApiError } from "./errors.js";
import type { AppEnv } from "./logger.js";
import { logger } from "./logger.js";

// Wraps every request: binds a request-scoped child logger onto the
// context (so route handlers can pull it via c.get("logger")), and logs
// exactly one completion line per request. c.error is a public Hono
// Context field set by compose() whenever a downstream handler throws,
// even though next() itself never rethrows past onError — so by the time
// next() resolves, c.error/c.res already reflect the final outcome.
export async function requestLogger(c: Context<AppEnv>, next: Next) {
  const requestId = crypto.randomUUID();
  const requestLog = logger.child({ request_id: requestId });
  c.set("logger", requestLog);

  const start = Date.now();
  requestLog.debug(
    { method: c.req.method, path: c.req.path },
    "request received",
  );

  await next();

  const fields = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Date.now() - start,
  };

  if (c.error && !(c.error instanceof ApiError)) {
    requestLog.error(
      { ...fields, err: c.error },
      "request failed with an unhandled error",
    );
  } else if (c.error instanceof ApiError) {
    requestLog.warn({ ...fields, err: c.error }, "request rejected");
  } else if (c.res.status >= 400) {
    requestLog.warn(fields, "request rejected");
  } else {
    requestLog.info(fields, "request completed");
  }
}
