# ledger-api

A small double-entry bookkeeping API — accounts, transactions, and the
immutable entries that belong to them. Balances are always derived by
summing entries, never stored and mutated directly. TypeScript on AWS
Lambda, Aurora Serverless v2 (Postgres) via the RDS Data API,
IAM-authenticated (SigV4) API Gateway.

Meant to be called by other services/applications, not end users directly
— see the auth section below.

## Design notes

- **Balances are derived, never stored.** Entries are immutable and
  append-only; `GET .../balance` always sums entries on the fly. Every
  transaction's entries must sum to exactly zero, enforced twice: in
  application code (`src/routes/transactions.ts`) and as a backstop by a
  `DEFERRABLE INITIALLY DEFERRED` constraint trigger in the database
  (`drizzle/0001_zero_sum_constraint.sql`).
- **Two DB drivers, one schema** (`src/db.ts`): `drizzle-orm/aws-data-api/pg`
  talks to Aurora Serverless v2 over the RDS Data API in the real Lambda
  (no VPC attachment needed, plain HTTPS); `drizzle-orm/node-postgres`
  talks to a real local Postgres in tests and `sam local`, since the Data
  API has no offline mock.
- **`accounts.type` is `text` + a `CHECK` constraint, not a Postgres
  enum** — `drizzle-orm`'s `aws-data-api/pg` driver doesn't cast
  parameters to a custom enum type on insert, a bug that only surfaces
  against the real Data API (`node-postgres`, used in tests, doesn't hit
  it). The `CHECK` constraint gives the same DB-level enforcement without
  the cast problem.
- **Idempotency**: `POST /transactions` requires an `idempotency_key`. A
  duplicate key returns the original transaction with `200` instead of
  double-posting — checked up front, with a race-condition fallback
  (`isUniqueViolation` in `src/lib/errors.ts`) if a concurrent request
  wins the insert between the check and the write.
- **Wire format is snake_case**; internals stay idiomatic camelCase,
  bridged in `src/lib/case.ts`/`src/lib/response.ts`.
- **Logging** (`src/lib/logger.ts`): structured JSON via
  [pino](https://getpino.io), one line per request plus a handful of
  business events, in default synchronous mode (no `pino.transport()` —
  its worker-thread mechanism doesn't survive esbuild's single-file
  bundle). Four levels, each with a specific meaning:
  - `debug` — verbose diagnostic detail (query params, a per-request
    "received" line). Off by default in prod.
  - `info` — notable events that succeeded (request completed, resource
    created, idempotent replay served).
  - `warn` — handled/expected failures (4xx responses, the idempotency
    race fallback, local auth rejections).
  - `error` — unexpected/unhandled exceptions.

  `LOG_LEVEL` controls the minimum level (default `info`; `template.yaml`
  sets `debug` for local dev, `vitest.config.ts` sets `silent` for tests).
  Since this runs on Lambda, anything written to stdout is captured
  automatically into CloudWatch Logs — that's already the aggregation
  point across every invocation. Forwarding CloudWatch onward to an
  external platform (Datadog, ELK, Grafana Loki, etc.) is a
  subscription-filter/infra concern configured outside this repo, same as
  Aurora and API Gateway.

## Structure

```
src/
  app.ts              Hono app: mounts every router, request logging, error handling
  index.ts             Lambda entrypoint — handle(app)
  db.ts                 Drizzle client factory — aws-data-api/pg in Lambda, node-postgres in tests
  schema.ts              accounts / transactions / entries tables
  routes/                 accounts.ts, transactions.ts, balances.ts
  lib/
    validation.ts           zod schemas, zJson (422 on body validation failure), zIdParam (404 on malformed :id)
    errors.ts                ApiError, isUniqueViolation (idempotency-replay detection, cross-driver)
    ledger.ts                 shared balance/lookup queries
    case.ts / response.ts      snake_case wire format bridge
    logger.ts / request-logger.ts  structured logging (pino) + the per-request logging middleware
local/                   Local-only SigV4 auth emulation for `sam local` (see Auth below) — never deployed
drizzle/                 SQL migrations (drizzle-kit generate), including the zero-sum constraint trigger
openapi/ledger-api.yaml  full API spec
tests/                  vitest, against a real local Postgres
```

## Commands

| Command                       | Action                                                                                          |
| :----------------------------- | :----------------------------------------------------------------------------------------------- |
| `npm install`                  | Install dependencies                                                                            |
| `npm run lint`                 | Lint (oxlint)                                                                                   |
| `npm run typecheck`            | Typecheck                                                                                       |
| `docker compose up -d`         | Start a local Postgres for tests (matches CI: `postgres:16`, db `ledger`, user/pass `postgres`) |
| `npm test`                     | Run tests — needs `DATABASE_URL` pointed at a local Postgres (defaults to the compose instance) |
| `npm run build`                | Bundle `src/index.ts` into `dist/index.mjs` (esbuild, minified) — the real prod Lambda artifact  |
| `npm run build:local-handler`  | Bundle `local/handler.ts` into `dist/local-handler.mjs` — local-only, wraps the app with SigV4 auth emulation |
| `npm run db:generate`          | Generate a migration from `src/schema.ts`                                                       |
| `npm run db:migrate`           | Apply migrations — targets Data API if `RESOURCE_ARN`/`SECRET_ARN` are set, else `DATABASE_URL` |
| `npm run start:local`          | Build both bundles, then serve the local handler behind a local API Gateway emulator (see below) |

## Local development

`npm run start:local` runs the app the way it actually runs in prod — a
built Lambda handler, invoked in a containerized Lambda runtime behind a
local HTTP API Gateway emulator (`sam local start-api`, via
`template.yaml`) — rather than a plain Node dev server. That means
requests go through the same `APIGatewayProxyEventV2`
translation/`hono/aws-lambda` code path production traffic does, so
payload-shape bugs show up locally instead of only after deploy.

Requires [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
(`brew install aws-sam-cli`) and Docker. One-time setup:

```bash
docker compose up -d                                                  # start Postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ledger \
  npm run db:migrate                                                  # apply migrations
```

Then:

```bash
npm run start:local   # serves http://127.0.0.1:3000
```

`template.yaml` points the function at `postgres://postgres:postgres@postgres:5432/ledger`
— the `sam local` container joins the compose project's Docker network
(`--docker-network ledger-api_default`, wired into the npm script) and
reaches Postgres by its compose service name, not `localhost`.

**Every request still needs a valid SigV4 signature locally** — see
"Auth" below for how to sign requests against the local server, including
from another service's local dev environment.

## Endpoints

See `openapi/ledger-api.yaml` for the full contract; summary:

- `POST`/`GET /accounts`, `GET /accounts/{id}`
- `GET /accounts/{id}/balance` — current, or `?as_of=YYYY-MM-DD`
- `GET /accounts/{id}/entries` — paginated
- `POST /transactions` — requires `idempotency_key`; a duplicate returns the original transaction with `200`
- `GET /transactions/{id}`
- `GET /balances` — all accounts, current or `?as_of=`

## Auth

Every route requires `AWS_IAM` (SigV4) — no shared secret, callers sign
with their own IAM credentials.

**In prod**, this is enforced entirely by API Gateway before the Lambda is
ever invoked; there's no app-level auth code (`src/` has none). An
unsigned or invalidly-signed request gets a `403` straight from API
Gateway. The calling service's IAM role needs a policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:<region>:<account-id>:<api-id>/*/*/*"
    }
  ]
}
```

Signing itself is just standard SigV4 against service `execute-api` —
any AWS SDK's request signer handles it if you hand it the caller's own
credentials (e.g. its Lambda execution role's, picked up automatically
via the SDK's default credential chain — no credentials to store).

**Locally**, `sam local` doesn't emulate API Gateway's `AWS_IAM`
authorizer at all, so there'd otherwise be nothing to exercise. Instead,
`local/handler.ts` (built to `dist/local-handler.mjs`, wired into
`template.yaml`, never deployed) wraps the real app with its own
from-scratch SigV4 verification (`local/verifySigV4.ts`) against a fixed,
non-secret credential pair — it only ever guards a local Postgres/Lambda
emulator, so there's nothing to keep secret:

- Access key ID: `local`
- Secret access key: `localsecretaccesskey`
- Region: `us-east-1` (or anything — it just has to match what you sign with)
- Service: `execute-api`

Sign requests with these credentials the same way you would for prod —
via [`awscurl`](https://github.com/okigan/awscurl) (`pip install awscurl`),
or your own SDK-based signer pointed at the local server instead of the
real one:

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=localsecretaccesskey \
  awscurl --service execute-api --region us-east-1 \
  -X POST http://127.0.0.1:3000/accounts \
  -H 'content-type: application/json' \
  -d '{"name": "cash", "type": "asset", "currency": "USD"}'
```

An unsigned request gets a `403` from the local handler, same shape as
prod's rejection (just for a different reason — see the response body).

**For another service's local dev environment calling this API locally**:
point it at `http://127.0.0.1:3000` (or wherever this is running/reachable
on your Docker network) and have it sign with the same fixed credentials
above instead of real AWS credentials.
