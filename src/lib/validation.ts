import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const accountTypeSchema = z.enum([
  "asset",
  "liability",
  "income",
  "expense",
]);

export const createAccountSchema = z.object({
  name: z.string().min(1),
  type: accountTypeSchema,
  // ISO 4217, e.g. "USD" — single currency per account.
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code"),
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const createTransactionSchema = z
  .object({
    idempotency_key: z.string().min(1),
    description: z.string().optional(),
    effective_date: dateSchema.optional(),
    entries: z
      .array(
        z.object({
          account_id: z.string().uuid(),
          amount: z.number().int(),
        }),
      )
      .min(2, "a transaction needs at least 2 entries"),
  })
  .refine(
    (data) => data.entries.reduce((sum, entry) => sum + entry.amount, 0) === 0,
    {
      message: "entries must sum to zero",
      path: ["entries"],
    },
  );

export const asOfQuerySchema = z.object({
  as_of: dateSchema.optional(),
});

// Offset pagination — simple and sufficient at personal-ledger scale;
// revisit as keyset pagination only if entry volume ever makes that matter.
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// A malformed :id (not a UUID) can never match a row, so treat it the same
// as "not found" rather than letting an invalid-UUID error reach Postgres.
export const zIdParam = zValidator(
  "param",
  z.object({ id: z.string().uuid() }),
  (result, c) => {
    if (!result.success) {
      return c.json({ error: "not found" }, 404);
    }
    return undefined;
  },
);

// Body-validation failures map to 422, not zod-validator's default 400 —
// covers "entries don't sum to zero, fewer than 2 entries, currency
// mismatch, unknown account" and malformed account payloads alike.
export const zJson = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation failed", details: z.flattenError(result.error) },
        422,
      );
    }
    return undefined;
  });
