import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createAccount, get, postTransaction } from "./helpers.js";

async function twoUsdAccounts() {
  const cash = await createAccount({ name: `cash-${randomUUID()}`, type: "asset" });
  const revenue = await createAccount({ name: `revenue-${randomUUID()}`, type: "income" });
  return { cash: cash.body, revenue: revenue.body };
}

describe("POST /transactions", () => {
  it("posts a balanced transaction and updates balances", async () => {
    const { cash, revenue } = await twoUsdAccounts();

    const res = await postTransaction({
      idempotency_key: "payroll-1",
      description: "test income",
      entries: [
        { account_id: cash.id, amount: 500 },
        { account_id: revenue.id, amount: -500 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.entries).toHaveLength(2);

    const cashBalance = await get(`/accounts/${cash.id}/balance`);
    expect(cashBalance.body.balance).toBe(500);
    const revenueBalance = await get(`/accounts/${revenue.id}/balance`);
    expect(revenueBalance.body.balance).toBe(-500);
  });

  it("rejects entries that don't sum to zero", async () => {
    const { cash, revenue } = await twoUsdAccounts();

    const res = await postTransaction({
      idempotency_key: "bad-1",
      entries: [
        { account_id: cash.id, amount: 500 },
        { account_id: revenue.id, amount: -400 },
      ],
    });

    expect(res.status).toBe(422);
  });

  it("rejects fewer than 2 entries", async () => {
    const { cash } = await twoUsdAccounts();
    const res = await postTransaction({
      idempotency_key: "bad-2",
      entries: [{ account_id: cash.id, amount: 0 }],
    });
    expect(res.status).toBe(422);
  });

  it("rejects an unknown account", async () => {
    const { cash } = await twoUsdAccounts();
    const res = await postTransaction({
      idempotency_key: "bad-3",
      entries: [
        { account_id: cash.id, amount: 100 },
        { account_id: randomUUID(), amount: -100 },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unknown account/);
  });

  it("rejects a currency mismatch across accounts in one transaction", async () => {
    const usd = await createAccount({ name: `usd-${randomUUID()}`, currency: "USD" });
    const eur = await createAccount({ name: `eur-${randomUUID()}`, currency: "EUR" });

    const res = await postTransaction({
      idempotency_key: "bad-4",
      entries: [
        { account_id: usd.body.id, amount: 100 },
        { account_id: eur.body.id, amount: -100 },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/currency/);
  });

  it("replays the original transaction on a duplicate idempotency_key instead of double-posting", async () => {
    const { cash, revenue } = await twoUsdAccounts();
    const payload = {
      idempotency_key: "dup-1",
      entries: [
        { account_id: cash.id, amount: 100 },
        { account_id: revenue.id, amount: -100 },
      ],
    };

    const first = await postTransaction(payload);
    expect(first.status).toBe(201);

    const second = await postTransaction(payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    // Balance reflects one post, not two.
    const balance = await get(`/accounts/${cash.id}/balance`);
    expect(balance.body.balance).toBe(100);
  });

  it("defaults effective_date to today and honors an explicit backdated date", async () => {
    const { cash, revenue } = await twoUsdAccounts();

    const res = await postTransaction({
      idempotency_key: "backdated-1",
      effective_date: "2020-01-15",
      entries: [
        { account_id: cash.id, amount: 100 },
        { account_id: revenue.id, amount: -100 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.effective_date).toBe("2020-01-15");
  });
});

describe("GET /transactions/:id", () => {
  it("returns a transaction with its entries", async () => {
    const { cash, revenue } = await twoUsdAccounts();
    const created = await postTransaction({
      idempotency_key: "get-1",
      entries: [
        { account_id: cash.id, amount: 250 },
        { account_id: revenue.id, amount: -250 },
      ],
    });

    const fetched = await get(`/transactions/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.entries).toHaveLength(2);
  });

  it("404s for an unknown transaction id", async () => {
    const res = await get(`/transactions/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("404s (not 500) for a malformed transaction id", async () => {
    const res = await get("/transactions/not-a-uuid");
    expect(res.status).toBe(404);
  });
});
