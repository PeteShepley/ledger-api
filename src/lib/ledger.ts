import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "../db.js";
import { accounts, entries, transactions } from "../schema.js";
import { notFound } from "./errors.js";

// effective_date is a plain date (no time component), so "now" is just
// today's UTC calendar date — there's no per-account timezone in the
// schema to be more precise than that.
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getAccountOrThrow(db: Database, id: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!account) throw notFound(`account ${id} not found`);
  return account;
}

export async function computeBalance(
  db: Database,
  accountId: string,
  asOf: string,
): Promise<number> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${entries.amount}), 0)` })
    .from(entries)
    .where(
      and(eq(entries.accountId, accountId), lte(entries.effectiveDate, asOf)),
    );
  return Number(row?.balance ?? 0);
}

export async function findTransactionWithEntries(
  db: Database,
  where: { id: string } | { idempotencyKey: string },
) {
  const condition =
    "id" in where
      ? eq(transactions.id, where.id)
      : eq(transactions.idempotencyKey, where.idempotencyKey);
  const [transaction] = await db.select().from(transactions).where(condition);
  if (!transaction) return undefined;
  const transactionEntries = await db
    .select()
    .from(entries)
    .where(eq(entries.transactionId, transaction.id));
  return { ...transaction, entries: transactionEntries };
}

export async function computeAllBalances(db: Database, asOf: string) {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(
      entries,
      and(eq(entries.accountId, accounts.id), lte(entries.effectiveDate, asOf)),
    )
    .groupBy(accounts.id, accounts.name, accounts.currency);

  return rows.map((row) => ({ ...row, balance: Number(row.balance) }));
}
