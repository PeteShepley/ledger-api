import pino from "pino";

// Structured logging guidelines — this is the one place log shape and
// level meaning are defined; every log call in this codebase should
// follow these rules.
//
// - debug: verbose diagnostic detail not needed in normal operation
//   (computed query params, a per-request "received" line). Off by
//   default in prod; on by default locally (see template.yaml).
// - info: notable events that succeeded (a request completed, a resource
//   was created, an idempotent replay was served).
// - warn: handled/expected failure conditions — 4xx responses, the
//   idempotency-race fallback path, local auth rejections. Nothing that
//   should page anyone, but worth tracking rates of.
// - error: unexpected/unhandled exceptions — anything reaching
//   app.onError's generic 500 branch. Always include the error itself.
//
// Every log line is structured (fields, not string interpolation), uses
// snake_case field names (matching this repo's convention that
// external-facing data is snake_case — see src/lib/case.ts), and never
// includes secrets (Authorization/x-amz-* signing headers, connection
// strings, full ARNs beyond what's needed).
//
// This runs on Lambda: anything written to stdout/stderr is captured
// automatically into CloudWatch Logs, which is already the aggregation
// point across every invocation. Forwarding CloudWatch onward to an
// external platform is a subscription-filter/infra concern configured
// outside this repo, the same way Aurora and API Gateway are.
export type Logger = pino.Logger;

export type AppEnv = { Variables: { logger: Logger } };

export const logger: Logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: "ledger-api" },
  serializers: { err: pino.stdSerializers.err },
});
