// Drizzle/TS stay idiomatic camelCase internally; the wire format is
// snake_case, matching resume-api's JSON convention and the field names in
// ledger-api-plan.md's own request/response examples. This is the one spot
// that bridges the two, applied to every response via lib/response.ts.
export function snakeCaseKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => snakeCaseKeys(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snakeCaseKeys(v),
      ]),
    ) as T;
  }
  return value;
}
