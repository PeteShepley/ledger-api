// Local-only Lambda entrypoint used by `template.yaml` / `sam local
// start-api`. Prod's real entrypoint (src/index.ts) has no auth code at
// all — AWS_IAM is enforced by API Gateway before the Lambda is ever
// invoked, and sam local doesn't emulate that. This wrapper substitutes a
// from-scratch SigV4 check (see verifySigV4.ts) so local dev can still
// exercise "unsigned/invalid request -> rejected, valid request -> passes
// through", without touching prod code or infra. Never deployed: this
// file isn't part of the `npm run build` bundle prod's dist/index.mjs
// comes from.
import type { LambdaContext } from "hono/aws-lambda";
import { handle } from "hono/aws-lambda";

import { app } from "../src/app.js";
import { logger } from "../src/lib/logger.js";
import { verifySigV4 } from "./verifySigV4.js";

const invokeApp = handle(app);

// hono/aws-lambda only re-exports its LambdaEvent union, not the concrete
// v2 event shape — this is the subset of APIGatewayProxyEventV2 (HttpApi,
// payload format 2.0, which is all `template.yaml` ever sends) this
// wrapper actually reads.
interface HttpApiEventV2 {
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

// Not secret — this only ever guards a local Postgres/Lambda emulator, and
// the values are documented in README.md. Override via env if you want.
const accessKeyId = process.env["LOCAL_SIGV4_ACCESS_KEY_ID"] ?? "local";
const secretAccessKey =
  process.env["LOCAL_SIGV4_SECRET_ACCESS_KEY"] ?? "localsecretaccesskey";

function forbidden(reason: string) {
  return {
    statusCode: 403,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Forbidden", reason }),
  };
}

export async function handler(event: HttpApiEventV2, context: LambdaContext) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }

  const rawBody = event.body ?? "";
  const body = event.isBase64Encoded
    ? Buffer.from(rawBody, "base64")
    : Buffer.from(rawBody, "utf8");

  const result = verifySigV4(
    {
      method: event.requestContext.http.method,
      path: event.rawPath,
      queryString: event.rawQueryString ?? "",
      headers,
      body,
    },
    { accessKeyId, secretAccessKey },
  );

  if (!result.ok) {
    logger.warn(
      {
        reason: result.reason,
        method: event.requestContext.http.method,
        path: event.rawPath,
      },
      "local sigv4 auth rejected request",
    );
    return forbidden(result.reason ?? "unauthorized");
  }

  return invokeApp(event as Parameters<typeof invokeApp>[0], context);
}
