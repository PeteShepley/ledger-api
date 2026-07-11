import { randomUUID } from "node:crypto";

import { app } from "../src/app.js";

type AccountInput = {
  name?: string;
  type?: "asset" | "liability" | "income" | "expense";
  currency?: string;
};

// Response shape varies per call site and is asserted in the test itself.
async function asJson(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

export async function createAccount(overrides: AccountInput = {}) {
  const res = await app.request("/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: overrides.name ?? `account-${randomUUID()}`,
      type: overrides.type ?? "asset",
      currency: overrides.currency ?? "USD",
    }),
  });
  return asJson(res);
}

export async function postTransaction(body: unknown) {
  const res = await app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson(res);
}

export async function get(path: string) {
  const res = await app.request(path);
  return asJson(res);
}
