export class ApiError extends Error {
  constructor(
    public readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unprocessable = (message: string) => new ApiError(422, message);
export const notFound = (message: string) => new ApiError(404, message);

// node-postgres surfaces a `.code === "23505"` DatabaseError for a unique
// violation. The RDS Data API driver doesn't preserve that structured code
// (it throws a generic BadRequestException) but does propagate the
// underlying Postgres error text in `.message` — so this checks both.
// Verify against real Data API behavior during deploy smoke-testing (see
// the design doc); this is the one cross-driver assumption in the
// idempotency path that isn't covered by the local Postgres test suite.
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && err.code === "23505") return true;
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint/i.test(err.message)
  );
}
