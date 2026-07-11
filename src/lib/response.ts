import type { Context } from "hono";

import { snakeCaseKeys } from "./case.js";

// Every successful response body goes through here so the wire format is
// consistently snake_case without route handlers having to think about it.
export function json(c: Context, payload: unknown, status = 200) {
  return c.json(snakeCaseKeys(payload) as never, status as never);
}
