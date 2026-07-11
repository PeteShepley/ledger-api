import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createAccount, get, postTransaction } from "./helpers.js";

describe("balances", () => {
  it("reports zero for every account with no transactions", async () => {
    await createAccount({ name: `a-${randomUUID()}` });
    await createAccount({ name: `b-${randomUUID()}` });

    const res = await get("/balances");
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(2);
    for (const account of res.body.accounts) {
      expect(account.balance).toBe(0);
    }
  });

  it("reflects posted transactions across all accounts", async () => {
    const cash = await createAccount({ name: `cash-${randomUUID()}` });
    const revenue = await createAccount({ name: `revenue-${randomUUID()}`, type: "income" });

    await postTransaction({
      idempotency_key: "bal-1",
      entries: [
        { account_id: cash.body.id, amount: 300 },
        { account_id: revenue.body.id, amount: -300 },
      ],
    });

    const res = await get("/balances");
    const byId = Object.fromEntries(res.body.accounts.map((a: { id: string; balance: number }) => [a.id, a.balance]));
    expect(byId[cash.body.id]).toBe(300);
    expect(byId[revenue.body.id]).toBe(-300);
  });

  it("as_of is inclusive of that exact date and excludes the day before", async () => {
    const cash = await createAccount({ name: `cash-${randomUUID()}` });
    const revenue = await createAccount({ name: `revenue-${randomUUID()}`, type: "income" });

    await postTransaction({
      idempotency_key: "bal-2",
      effective_date: "2024-06-15",
      entries: [
        { account_id: cash.body.id, amount: 100 },
        { account_id: revenue.body.id, amount: -100 },
      ],
    });

    const before = await get(`/accounts/${cash.body.id}/balance?as_of=2024-06-14`);
    expect(before.body.balance).toBe(0);

    const onDate = await get(`/accounts/${cash.body.id}/balance?as_of=2024-06-15`);
    expect(onDate.body.balance).toBe(100);

    const after = await get(`/accounts/${cash.body.id}/balance?as_of=2024-06-16`);
    expect(after.body.balance).toBe(100);
  });

  it("404s for an unknown account's balance", async () => {
    const res = await get(`/accounts/${randomUUID()}/balance`);
    expect(res.status).toBe(404);
  });
});
