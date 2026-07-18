import { describe, expect, it } from "vitest";

import {
  type LocalRequest,
  signSigV4,
  verifySigV4,
} from "../local/verifySigV4.js";

const credentials = { accessKeyId: "local", secretAccessKey: "localsecretaccesskey" };
const region = "us-east-1";
const service = "execute-api";

function signedRequest(
  overrides: Partial<LocalRequest> = {},
  signAt = new Date(),
): LocalRequest {
  const base: LocalRequest = {
    method: "POST",
    path: "/accounts",
    queryString: "",
    headers: { host: "127.0.0.1:3000" },
    body: JSON.stringify({ name: "cash", type: "asset", currency: "USD" }),
    ...overrides,
  };
  const { authorization, amzDate } = signSigV4(
    base,
    credentials,
    region,
    service,
    signAt,
  );
  return {
    ...base,
    headers: { ...base.headers, authorization, "x-amz-date": amzDate },
  };
}

describe("verifySigV4", () => {
  it("accepts a correctly signed POST request", () => {
    expect(verifySigV4(signedRequest(), credentials)).toEqual({ ok: true });
  });

  it("accepts a correctly signed GET request with query params", () => {
    const request = signedRequest({
      method: "GET",
      path: "/accounts/123/balance",
      queryString: "as_of=2026-01-01",
      body: "",
    });
    expect(verifySigV4(request, credentials)).toEqual({ ok: true });
  });

  it("rejects a request with no authorization header", () => {
    const result = verifySigV4(
      { method: "GET", path: "/accounts", queryString: "", headers: {}, body: "" },
      credentials,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing authorization header/);
  });

  it("rejects a request signed with the wrong secret", () => {
    const request = signedRequest();
    const result = verifySigV4(request, {
      accessKeyId: "local",
      secretAccessKey: "wrong-secret",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/);
  });

  it("rejects a request with an unknown access key id", () => {
    const request = signedRequest();
    const result = verifySigV4(request, {
      accessKeyId: "not-local",
      secretAccessKey: "localsecretaccesskey",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unknown access key id/);
  });

  it("rejects a request whose body was tampered with after signing", () => {
    const request = signedRequest();
    const tampered = { ...request, body: JSON.stringify({ name: "checking" }) };
    const result = verifySigV4(tampered, credentials);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/);
  });

  it("rejects a request with a stale x-amz-date", () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const request = signedRequest({}, staleDate);
    const result = verifySigV4(request, credentials);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/clock skew/);
  });

  it("rejects a request with a mismatched host (signed for a different host)", () => {
    const request = signedRequest({ headers: { host: "127.0.0.1:3000" } });
    const tampered = { ...request, headers: { ...request.headers, host: "evil:9999" } };
    const result = verifySigV4(tampered, credentials);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/);
  });
});
