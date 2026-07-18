// Local-only reimplementation of AWS SigV4 request signing/verification
// (https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html),
// used solely so `sam local start-api` can exercise "signed vs unsigned
// request" behavior the way prod's AWS_IAM authorizer does — sam local
// doesn't emulate AWS_IAM itself (see local/handler.ts). Not used in prod;
// never bundled into dist/index.mjs.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

export interface LocalRequest {
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, string>;
  body: string | Buffer;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

function hexEncode(char: string): string {
  return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
}

// encodeURIComponent leaves `! ' ( ) *` unescaped; SigV4 wants only
// unreserved characters (A-Za-z0-9-_.~) left alone.
function escapeUri(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, hexEncode);
}

function canonicalUri(path: string): string {
  if (!path || path === "/") return "/";
  return path
    .split("/")
    .map((segment) => escapeUri(segment))
    .join("/");
}

function canonicalQueryString(queryString: string): string {
  if (!queryString) return "";
  const params: [string, string][] = [];
  for (const pair of queryString.split("&")) {
    if (!pair) continue;
    const [rawKey = "", rawValue = ""] = pair.split("=");
    params.push([
      escapeUri(decodeURIComponent(rawKey)),
      escapeUri(decodeURIComponent(rawValue)),
    ]);
  }
  params.sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
  });
  return params.map(([key, value]) => `${key}=${value}`).join("&");
}

function trimHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// Builds the canonical request + string-to-sign, sharing logic between
// signing (tests) and verification so they can't drift apart.
function buildStringToSign(
  request: LocalRequest,
  signedHeaders: string[],
  amzDate: string,
  date: string,
  region: string,
  service: string,
): { stringToSign: string; bodyHash: string } {
  const bodyHash = sha256Hex(request.body);
  const canonicalHeaderLines: string[] = [];
  for (const name of signedHeaders) {
    // Always use our own computed hash for this slot, never the client's
    // claimed header value — otherwise a swapped body with a stale-but
    // previously-valid content-sha256 header would still verify.
    const value =
      name === "x-amz-content-sha256" ? bodyHash : request.headers[name];
    if (value === undefined) {
      throw new Error(`missing signed header: ${name}`);
    }
    canonicalHeaderLines.push(`${name}:${trimHeaderValue(value)}`);
  }

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(request.path),
    canonicalQueryString(request.queryString),
    `${canonicalHeaderLines.join("\n")}\n`,
    signedHeaders.join(";"),
    bodyHash,
  ].join("\n");

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  return { stringToSign, bodyHash };
}

interface ParsedAuthorization {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
}

function parseAuthorizationHeader(
  value: string,
): ParsedAuthorization | undefined {
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const [, credential, signedHeadersRaw, signature] = match;
  const credentialParts = credential!.split("/");
  if (credentialParts.length !== 5 || credentialParts[4] !== "aws4_request") {
    return undefined;
  }
  const [accessKeyId, date, region, service] = credentialParts;
  return {
    accessKeyId: accessKeyId!,
    date: date!,
    region: region!,
    service: service!,
    signedHeaders: signedHeadersRaw!.split(";"),
    signature: signature!,
  };
}

export function verifySigV4(
  request: LocalRequest,
  credentials: Credentials,
  maxClockSkewSeconds = 300,
): VerifyResult {
  const authorizationHeader = request.headers["authorization"];
  if (!authorizationHeader) {
    return { ok: false, reason: "missing authorization header" };
  }

  const parsed = parseAuthorizationHeader(authorizationHeader);
  if (!parsed) return { ok: false, reason: "malformed authorization header" };

  if (parsed.accessKeyId !== credentials.accessKeyId) {
    return { ok: false, reason: "unknown access key id" };
  }
  if (
    !parsed.signedHeaders.includes("host") ||
    !parsed.signedHeaders.includes("x-amz-date")
  ) {
    return { ok: false, reason: "host/x-amz-date must be signed" };
  }

  const amzDate = request.headers["x-amz-date"];
  if (!amzDate) return { ok: false, reason: "missing x-amz-date header" };
  if (!amzDate.startsWith(parsed.date)) {
    return { ok: false, reason: "x-amz-date doesn't match credential scope date" };
  }

  const requestTime = Date.parse(
    `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
      `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
  );
  if (
    !Number.isFinite(requestTime) ||
    Math.abs(Date.now() - requestTime) > maxClockSkewSeconds * 1000
  ) {
    return { ok: false, reason: "x-amz-date outside allowed clock skew" };
  }

  let stringToSign: string;
  try {
    ({ stringToSign } = buildStringToSign(
      request,
      parsed.signedHeaders,
      amzDate,
      parsed.date,
      parsed.region,
      parsed.service,
    ));
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const signingKey = deriveSigningKey(
    credentials.secretAccessKey,
    parsed.date,
    parsed.region,
    parsed.service,
  );
  const expected = hmac(signingKey, stringToSign);
  const actual = Buffer.from(parsed.signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "signature mismatch" };
  }

  return { ok: true };
}

// Test-only counterpart to verifySigV4 — signs a request the same way a
// real SigV4 client (awscurl, boto3, aws-sdk) would, so tests can exercise
// verifySigV4 against genuinely valid signatures instead of hand-built
// fixtures.
export function signSigV4(
  request: LocalRequest,
  credentials: Credentials,
  region: string,
  service: string,
  date = new Date(),
): { authorization: string; amzDate: string } {
  const amzDate = date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = ["host", "x-amz-date", "x-amz-content-sha256"];

  const requestWithDate: LocalRequest = {
    ...request,
    headers: { ...request.headers, "x-amz-date": amzDate },
  };

  const { stringToSign } = buildStringToSign(
    requestWithDate,
    signedHeaders,
    amzDate,
    dateStamp,
    region,
    service,
  );
  const signingKey = deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service,
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const authorization =
    `${ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;

  return { authorization, amzDate };
}
