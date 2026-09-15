import assert from "node:assert/strict";
import test from "node:test";
import { StrKey } from "@stellar/stellar-sdk";
import { applySlippage, fetchQuote } from "./quote";

function asset(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

function quoteResponse(body: Record<string, string>, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface FetchStub {
  calls: number;
  restore: () => void;
}

function stubQuoteFetch(response: Response): FetchStub {
  const original = globalThis.fetch;
  const stub: FetchStub = {
    calls: 0,
    restore: () => {
      globalThis.fetch = original;
    },
  };
  globalThis.fetch = (async () => {
    stub.calls += 1;
    return response;
  }) as typeof fetch;
  return stub;
}

test("applies a slippage tolerance to a quoted amount", () => {
  assert.equal(applySlippage(10_000_000n, 100), 9_900_000n);
  assert.equal(applySlippage(10_000_000n, 0), 10_000_000n);
  assert.equal(applySlippage(1_000_000n, 10_000), 1n);
});

test("never rounds a positive quote down to a zero minimum received", () => {
  for (const amountOut of [1n, 2n, 9n, 99n, 10_000n]) {
    for (const slippageBps of [1, 100, 5_000, 9_999, 10_000]) {
      assert.ok(applySlippage(amountOut, slippageBps) > 0n);
    }
  }
  assert.equal(applySlippage(1n, 100), 1n);
  assert.equal(applySlippage(5n, 10_000), 1n);
});

test("rejects a non-positive or non-bigint quote", () => {
  assert.throws(() => applySlippage(0n, 100), /amount out must be a positive bigint/);
  assert.throws(() => applySlippage(-1n, 100), /amount out must be a positive bigint/);
  assert.throws(() => applySlippage(1_000 as unknown as bigint, 100), /amount out must be a positive bigint/);
});

test("rejects a slippage tolerance outside 0-10000 bps", () => {
  assert.throws(() => applySlippage(1_000n, -1), /slippageBps must be an integer between 0 and 10000/);
  assert.throws(() => applySlippage(1_000n, 10_001), /slippageBps must be an integer between 0 and 10000/);
  assert.throws(() => applySlippage(1_000n, 1.5), /slippageBps must be an integer between 0 and 10000/);
  assert.throws(() => applySlippage(1_000n, Number.NaN), /slippageBps must be an integer between 0 and 10000/);
});

const validQuote = { amountOut: "9900000", otherAmountThreshold: "9800000", priceImpactPct: "0.1" };

test("rejects malformed assets and non-positive amounts before calling the quote API", async () => {
  const calls: Array<() => Promise<unknown>> = [
    () => fetchQuote("not-a-contract", asset(2), 1_000n),
    () => fetchQuote(asset(1), "G-not-a-contract", 1_000n),
    () => fetchQuote(asset(1), asset(2), 0n),
    () => fetchQuote(asset(1), asset(2), -1n),
  ];

  for (const call of calls) {
    const stub = stubQuoteFetch(quoteResponse(validQuote));
    try {
      await assert.rejects(call);
    } finally {
      stub.restore();
    }
    assert.equal(stub.calls, 0);
  }
});

test("returns bigint quote values", async () => {
  const stub = stubQuoteFetch(quoteResponse(validQuote));
  try {
    const preview = await fetchQuote(asset(1), asset(2), 10_000_000n);
    assert.equal(preview.amountOut, 9_900_000n);
    assert.equal(preview.otherAmountThreshold, 9_800_000n);
    assert.equal(typeof preview.amountOut, "bigint");
    assert.equal(preview.priceImpactPct, "0.1");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls, 1);
});

test("rejects a quote that is not positive", async () => {
  const stub = stubQuoteFetch(quoteResponse({ amountOut: "0", otherAmountThreshold: "0", priceImpactPct: "0" }));
  try {
    await assert.rejects(fetchQuote(asset(1), asset(2), 10_000_000n), /non-positive amount out/);
  } finally {
    stub.restore();
  }
});

test("rejects a malformed quote response", async () => {
  const stub = stubQuoteFetch(
    quoteResponse({ amountOut: "not-a-number", otherAmountThreshold: "0", priceImpactPct: "0" }),
  );
  try {
    await assert.rejects(fetchQuote(asset(1), asset(2), 10_000_000n), /malformed amountOut/);
  } finally {
    stub.restore();
  }
});

test("surfaces the API error message", async () => {
  const stub = stubQuoteFetch(
    quoteResponse({ amountOut: "", otherAmountThreshold: "", priceImpactPct: "", error: "rate limited" }, false, 502),
  );
  try {
    await assert.rejects(fetchQuote(asset(1), asset(2), 10_000_000n), /rate limited/);
  } finally {
    stub.restore();
  }
});
