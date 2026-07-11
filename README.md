# ledger-api

A small double-entry bookkeeping API — accounts, transactions, and the
immutable entries that belong to them. Balances are always derived by
summing entries, never stored and mutated directly. TypeScript on AWS
Lambda, Aurora Serverless v2 (Postgres) via the RDS Data API,
IAM-authenticated (SigV4) API Gateway.

Meant to be called by other services/applications, not end users directly
— see the auth section below.

For why things are built this way, and how the deployment infra fits
together, see the design doc and build journal in the sibling `operations`
repo: `operations/docs/projects/ledger-api/design.md` and
`operations/docs/projects/ledger-api/journal.md`. The original domain
design is `operations/ledger-api-plan.md`.

## Structure

```
src/
  app.ts              Hono app: mounts every router, error handling
  index.ts             Lambda entrypoint — handle(app)
  db.ts                 Drizzle client factory — aws-data-api/pg in Lambda, node-postgres in tests
  schema.ts              accounts / transactions / entries tables
  routes/                 accounts.ts, transactions.ts, balances.ts
  lib/
    validation.ts           zod schemas, zJson (422 on body validation failure), zIdParam (404 on malformed :id)
    errors.ts                ApiError, isUniqueViolation (idempotency-replay detection, cross-driver)
    ledger.ts                 shared balance/lookup queries
    case.ts / response.ts      snake_case wire format bridge
drizzle/                 SQL migrations (drizzle-kit generate), including the zero-sum constraint trigger
openapi/ledger-api.yaml  full API spec
tests/                  vitest, against a real local Postgres (see design.md's "Testing tradeoff")
```

## Commands

| Command               | Action                                                                                          |
|:----------------------|:------------------------------------------------------------------------------------------------|
| `npm install`         | Install dependencies                                                                            |
| `npm run lint`        | Lint (oxlint)                                                                                   |
| `npm run typecheck`   | Typecheck                                                                                       |
| `npm test`            | Run tests — needs `DATABASE_URL` pointed at a local Postgres                                    |
| `npm run build`       | Bundle `src/index.ts` into `dist/index.mjs` (esbuild)                                           |
| `npm run db:generate` | Generate a migration from `src/schema.ts`                                                       |
| `npm run db:migrate`  | Apply migrations — targets Data API if `RESOURCE_ARN`/`SECRET_ARN` are set, else `DATABASE_URL` |

## Endpoints

See `openapi/ledger-api.yaml` for the full contract; summary:

- `POST`/`GET /accounts`, `GET /accounts/{id}`
- `GET /accounts/{id}/balance` — current, or `?as_of=YYYY-MM-DD`
- `GET /accounts/{id}/entries` — paginated
- `POST /transactions` — requires `idempotency_key`; a duplicate returns the original transaction with `200`
- `GET /transactions/{id}`
- `GET /balances` — all accounts, current or `?as_of=`

## Auth

Every route requires `AWS_IAM` (SigV4). Callers need an IAM policy
granting `execute-api:Invoke` on this API's ARN — see
`operations/docs/runbooks/ledger-api-deployment.md` for the exact policy
shape and how to sign requests.
