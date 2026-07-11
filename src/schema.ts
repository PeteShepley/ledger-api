import { relations } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// See ledger-api-plan.md (repo root) for the design this implements.

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "income",
  "expense",
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  type: accountType("type").notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  description: text("description"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  effectiveDate: date("effective_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    // Signed, minor units (cents). `mode: "number"` — personal-scale
    // amounts stay well inside Number.MAX_SAFE_INTEGER, and it keeps
    // JSON responses free of BigInt serialization handling.
    amount: bigint("amount", { mode: "number" }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("entries_account_id_effective_date_idx").on(
      table.accountId,
      table.effectiveDate,
    ),
    // Backs both `findTransactionWithEntries` and the zero-sum constraint
    // trigger's per-transaction lookup (see the 0001 migration).
    index("entries_transaction_id_idx").on(table.transactionId),
  ],
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  entries: many(entries),
}));

export const transactionsRelations = relations(transactions, ({ many }) => ({
  entries: many(entries),
}));

export const entriesRelations = relations(entries, ({ one }) => ({
  transaction: one(transactions, {
    fields: [entries.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [entries.accountId],
    references: [accounts.id],
  }),
}));
