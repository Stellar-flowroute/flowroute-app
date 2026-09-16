import assert from "node:assert/strict";
import test from "node:test";
import { buildQuoteErrorResponseBody, describeQuoteError } from "./quote-error";

test("extracts the message from a plain Error", () => {
  const info = describeQuoteError(new Error("network unreachable"));
  assert.equal(info.message, "network unreachable");
  assert.equal(info.status, undefined);
  assert.equal(info.code, undefined);
});

test("extracts code and status from an axios-shaped network error, never its request config", () => {
  const axiosLikeError = Object.assign(new Error("timeout of 30000ms exceeded"), {
    code: "ECONNABORTED",
    config: {
      url: "https://api.soroswap.finance/quote",
      headers: { Authorization: "Bearer super-secret-soroswap-key", "Content-Type": "application/json" },
    },
  });

  const info = describeQuoteError(axiosLikeError);

  assert.equal(info.message, "timeout of 30000ms exceeded");
  assert.equal(info.code, "ECONNABORTED");
  const serialized = JSON.stringify(info);
  assert.ok(!serialized.includes("super-secret-soroswap-key"));
  assert.ok(!serialized.includes("Authorization"));
});

test("extracts status and sanitized details from an axios error with a response", () => {
  const axiosLikeError = Object.assign(new Error("Request failed with status code 429"), {
    response: {
      status: 429,
      data: { message: "rate limited", statusCode: 429, error: "Too Many Requests" },
      config: { headers: { Authorization: "Bearer super-secret-soroswap-key" } },
    },
  });

  const info = describeQuoteError(axiosLikeError);

  assert.equal(info.status, 429);
  assert.equal(info.details?.message, "rate limited");
  const serialized = JSON.stringify(info);
  assert.ok(!serialized.includes("super-secret-soroswap-key"));
});

test("extracts message/status/code from the raw upstream body Soroswap's SDK rejects with", () => {
  // This is the shape @soroswap/sdk's http client actually rejects with on a non-2xx response: the raw
  // response body, not an Error instance, which the previous code treated as "quote request failed".
  const upstreamBody = { statusCode: 400, message: "assetIn is not tradeable", error: "Bad Request" };

  const info = describeQuoteError(upstreamBody);

  assert.equal(info.message, "assetIn is not tradeable");
  assert.equal(info.status, 400);
  assert.equal(info.details?.error, "Bad Request");
});

test("falls back to the error field when message is absent", () => {
  const info = describeQuoteError({ error: "insufficient liquidity" });
  assert.equal(info.message, "insufficient liquidity");
});

test("handles a plain string rejection", () => {
  const info = describeQuoteError("upstream exploded");
  assert.equal(info.message, "upstream exploded");
});

test("falls back to a generic message for anything unrecognized", () => {
  assert.equal(describeQuoteError(null).message, "quote request failed");
  assert.equal(describeQuoteError(undefined).message, "quote request failed");
  assert.equal(describeQuoteError(42).message, "quote request failed");
  assert.equal(describeQuoteError({}).message, "quote request failed");
});

test("redacts sensitive-looking keys nested inside details", () => {
  const upstreamBody = {
    message: "bad request",
    details: {
      reason: "invalid pair",
      authorization: "Bearer super-secret-soroswap-key",
      apiKey: "super-secret-soroswap-key",
      nested: { cookie: "session=abc", ok: true },
    },
  };

  const info = describeQuoteError(upstreamBody);

  const serialized = JSON.stringify(info);
  assert.ok(!serialized.includes("super-secret-soroswap-key"));
  assert.ok(!serialized.includes("session=abc"));
  assert.equal((info.details?.details as Record<string, unknown>).reason, "invalid pair");
});

test("builds a minimal diagnostic response body with only the allowlisted fields", () => {
  const info = describeQuoteError({ statusCode: 429, message: "rate limited", error: "Too Many Requests" });

  const body = buildQuoteErrorResponseBody(info, "req-123");

  assert.deepEqual(body, {
    error: "rate limited",
    diagnostic: {
      requestId: "req-123",
      upstreamStatus: 429,
      upstreamCode: undefined,
      upstreamMessage: "rate limited",
    },
  });
});

test("the diagnostic response body never includes info.details or arbitrary upstream data", () => {
  const axiosLikeError = Object.assign(new Error("Request failed with status code 500"), {
    response: {
      status: 500,
      data: {
        message: "internal error",
        details: { authorization: "Bearer super-secret-soroswap-key", reason: "pool unavailable" },
      },
      config: { headers: { Authorization: "Bearer super-secret-soroswap-key" } },
    },
  });
  const info = describeQuoteError(axiosLikeError);
  assert.ok(info.details, "sanity check: describeQuoteError did extract details for this error");

  const body = buildQuoteErrorResponseBody(info, "req-456");

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("super-secret-soroswap-key"));
  assert.ok(!("details" in body.diagnostic));
  assert.deepEqual(Object.keys(body.diagnostic).sort(), ["requestId", "upstreamCode", "upstreamMessage", "upstreamStatus"]);
});
