import { inArray } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db.js";
import { isUniqueViolation, notFound, unprocessable } from "../lib/errors.js";
import { findTransactionWithEntries, today } from "../lib/ledger.js";
import type { AppEnv } from "../lib/logger.js";
import { json } from "../lib/response.js";
import { createTransactionSchema, zIdParam, zJson } from "../lib/validation.js";
import { accounts, entries, transactions } from "../schema.js";

const app = new Hono<AppEnv>();

app.post("/", zJson(createTransactionSchema), async (c) => {
  const db = getDb();
  const body = c.req.valid("json");

  // Fast path: this is a genuine retry of an already-posted transaction.
  const existing = await findTransactionWithEntries(db, {
    idempotencyKey: body.idempotency_key,
  });
  if (existing) {
    c.get("logger").info(
      { transaction_id: existing.id, idempotency_key: body.idempotency_key },
      "idempotent replay: returning existing transaction",
    );
    return json(c, existing, 200);
  }

  const accountIds = [
    ...new Set(body.entries.map((entry) => entry.account_id)),
  ];
  const referencedAccounts = await db
    .select()
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  if (referencedAccounts.length !== accountIds.length) {
    const found = new Set(referencedAccounts.map((account) => account.id));
    const missing = accountIds.filter((id) => !found.has(id));
    c.get("logger").warn(
      { missing_account_ids: missing },
      "transaction rejected: unknown account(s)",
    );
    throw unprocessable(`unknown account(s): ${missing.join(", ")}`);
  }
  if (new Set(referencedAccounts.map((account) => account.currency)).size > 1) {
    c.get("logger").warn(
      { account_ids: accountIds },
      "transaction rejected: currency mismatch across entries",
    );
    throw unprocessable(
      "all entries in a transaction must reference accounts with the same currency",
    );
  }

  const effectiveDate = body.effective_date ?? today();

  try {
    const created = await db.transaction(async (tx) => {
      const [transaction] = await tx
        .insert(transactions)
        .values({
          description: body.description,
          idempotencyKey: body.idempotency_key,
          effectiveDate,
        })
        .returning();
      const insertedEntries = await tx
        .insert(entries)
        .values(
          body.entries.map((entry) => ({
            transactionId: transaction!.id,
            accountId: entry.account_id,
            amount: entry.amount,
            effectiveDate,
          })),
        )
        .returning();
      return { ...transaction!, entries: insertedEntries };
    });
    c.get("logger").info(
      {
        transaction_id: created.id,
        entry_count: created.entries.length,
        effective_date: effectiveDate,
      },
      "transaction created",
    );
    return json(c, created, 201);
  } catch (err) {
    // Concurrent duplicate submission: someone else's insert won the race
    // against the idempotency_key unique constraint between our read above
    // and our insert. Their record is the source of truth — return it.
    if (isUniqueViolation(err)) {
      const replay = await findTransactionWithEntries(db, {
        idempotencyKey: body.idempotency_key,
      });
      if (replay) {
        c.get("logger").warn(
          { idempotency_key: body.idempotency_key },
          "idempotency race: concurrent insert won, serving replay",
        );
        return json(c, replay, 200);
      }
    }
    throw err;
  }
});

app.get("/:id", zIdParam, async (c) => {
  const id = c.req.valid("param").id;
  const transaction = await findTransactionWithEntries(getDb(), { id });
  if (!transaction) throw notFound(`transaction ${id} not found`);
  return json(c, transaction);
});

export default app;
