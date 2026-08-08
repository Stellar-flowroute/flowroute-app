import assert from "node:assert/strict";
import test from "node:test";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { i128ToScVal, scValToI128 } from "./xdr.js";

const I128_MIN = -(2n ** 127n);
const I128_MAX = 2n ** 127n - 1n;

test("round trips a value above Number.MAX_SAFE_INTEGER", () => {
  const value = BigInt(Number.MAX_SAFE_INTEGER) + 1_000_000_000n;
  assert.equal(scValToI128(i128ToScVal(value)), value);
});

test("round trips zero", () => {
  assert.equal(scValToI128(i128ToScVal(0n)), 0n);
});

test("round trips a negative value", () => {
  const value = -(BigInt(Number.MAX_SAFE_INTEGER) + 42n);
  assert.equal(scValToI128(i128ToScVal(value)), value);
});

test("round trips the minimum i128 value", () => {
  assert.equal(scValToI128(i128ToScVal(I128_MIN)), I128_MIN);
});

test("round trips the maximum i128 value", () => {
  assert.equal(scValToI128(i128ToScVal(I128_MAX)), I128_MAX);
});

test("throws when the value overflows i128", () => {
  assert.throws(() => i128ToScVal(I128_MAX + 1n));
  assert.throws(() => i128ToScVal(I128_MIN - 1n));
});

test("rejects an ScVal that is not an i128", () => {
  const u64ScVal = nativeToScVal(1000n, { type: "u64" });
  assert.throws(() => scValToI128(u64ScVal));
});
