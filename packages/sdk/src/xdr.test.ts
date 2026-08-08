import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { PayoutResult, Recipient } from "./types";
import {
  i128ToScVal,
  recipientToScVal,
  recipientsToScVal,
  scValToI128,
  scValToPayoutResult,
  scValToPayoutResults,
} from "./xdr";

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

function payoutResultToScVal(result: PayoutResult): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount_delivered"),
      val: i128ToScVal(result.amount_delivered),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("recipient"),
      val: nativeToScVal(result.recipient, { type: "address" }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("success"),
      val: xdr.ScVal.scvBool(result.success),
    }),
  ]);
}

test("encodes a recipient as a symbol-keyed struct map sorted by field name", () => {
  const recipient: Recipient = {
    address: Keypair.random().publicKey(),
    dest_asset: Keypair.random().publicKey(),
    dest_min: 12345n,
    amount_in: BigInt(Number.MAX_SAFE_INTEGER) + 999_999_999n,
  };

  const scv = recipientToScVal(recipient);
  assert.equal(scv.switch().name, "scvMap");
  const entries = scv.map() ?? [];
  assert.deepEqual(
    entries.map((entry) => entry.key().sym().toString()),
    ["address", "amount_in", "dest_asset", "dest_min"],
  );
  assert.equal(scValToI128(entries[1]!.val()), recipient.amount_in);
  assert.equal(scValToI128(entries[3]!.val()), recipient.dest_min);
});

test("encodes a list of recipients as a vec", () => {
  const recipients: Recipient[] = [
    { address: Keypair.random().publicKey(), dest_asset: Keypair.random().publicKey(), dest_min: 1n, amount_in: 2n },
    { address: Keypair.random().publicKey(), dest_asset: Keypair.random().publicKey(), dest_min: 3n, amount_in: 4n },
  ];

  const scv = recipientsToScVal(recipients);
  assert.equal(scv.switch().name, "scvVec");
  assert.equal(scv.vec()?.length, 2);
});

test("round trips a payout result", () => {
  const result: PayoutResult = {
    recipient: Keypair.random().publicKey(),
    success: true,
    amount_delivered: BigInt(Number.MAX_SAFE_INTEGER) + 555n,
  };
  assert.deepEqual(scValToPayoutResult(payoutResultToScVal(result)), result);
});

test("round trips a failed payout result with zero delivered", () => {
  const result: PayoutResult = {
    recipient: Keypair.random().publicKey(),
    success: false,
    amount_delivered: 0n,
  };
  assert.deepEqual(scValToPayoutResult(payoutResultToScVal(result)), result);
});

test("decodes a vec of payout results", () => {
  const results: PayoutResult[] = [
    { recipient: Keypair.random().publicKey(), success: true, amount_delivered: 100n },
    { recipient: Keypair.random().publicKey(), success: false, amount_delivered: 0n },
  ];
  const scv = xdr.ScVal.scvVec(results.map(payoutResultToScVal));
  assert.deepEqual(scValToPayoutResults(scv), results);
});

test("rejects a payout result missing a field", () => {
  const scv = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("success"), val: xdr.ScVal.scvBool(true) }),
  ]);
  assert.throws(() => scValToPayoutResult(scv));
});
