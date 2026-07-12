import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createAccount, get, postTransaction } from "./helpers.js";

describe("accounts", () => {
  it("creates and fetches an account", async () => {
    const created = await createAccount({
      name: "cash",
      type: "asset",
      currency: "USD",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "cash",
      type: "asset",
      currency: "USD",
    });

    const fetched = await get(`/accounts/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(created.body.id);
  });

  it("rejects a non-ISO currency code", async () => {
    const res = await createAccount({ currency: "dollars" });
    expect(res.status).toBe(422);
  });

  it("lists all accounts", async () => {
    await createAccount({ name: "a" });
    await createAccount({ name: "b" });
    const res = await get("/accounts");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("404s for an unknown account id", async () => {
    const res = await get(`/accounts/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("404s (not 500) for a malformed account id", async () => {
    const res = await get("/accounts/not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("reports a zero balance and empty entry history before any transactions", async () => {
    const account = await createAccount();

    const balance = await get(`/accounts/${account.body.id}/balance`);
    expect(balance.status).toBe(200);
    expect(balance.body.balance).toBe(0);

    const entries = await get(`/accounts/${account.body.id}/entries`);
    expect(entries.status).toBe(200);
    expect(entries.body.items).toEqual([]);
  });

  it("lists an account's entries after a transaction posts", async () => {
    const cash = await createAccount({ name: "cash" });
    const revenue = await createAccount({ name: "revenue", type: "income" });

    await postTransaction({
      idempotency_key: "t1",
      entries: [
        { account_id: cash.body.id, amount: 500 },
        { account_id: revenue.body.id, amount: -500 },
      ],
    });

    const entries = await get(`/accounts/${cash.body.id}/entries`);
    expect(entries.body.items).toHaveLength(1);
    expect(entries.body.items[0].amount).toBe(500);
  });
});
