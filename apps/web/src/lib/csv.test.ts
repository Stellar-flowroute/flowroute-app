import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { MAX_BATCH_RECIPIENTS } from "@stellar-flowroute/sdk";
import { parseRecipientsCsv } from "./csv";

function account(): string {
  return Keypair.random().publicKey();
}

function asset(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

function row(seed: number, amountIn = "1000"): string {
  return `${account()},${asset(seed)},${amountIn}`;
}

test("parses a CSV with a header row and blank lines", () => {
  const parsed = parseRecipientsCsv(`address,dest_asset,amount_in\n\n${row(1)}\n${row(2)}\n`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1]!.amountIn, "1000");
  assert.equal(parsed[1]!.destAsset, asset(2));
});

test("accepts exactly MAX_BATCH_RECIPIENTS rows", () => {
  const csv = Array.from({ length: MAX_BATCH_RECIPIENTS }, (_, index) => row(index + 1)).join("\n");
  assert.equal(parseRecipientsCsv(csv).length, MAX_BATCH_RECIPIENTS);
});

test("rejects a CSV with more than MAX_BATCH_RECIPIENTS rows", () => {
  const csv = Array.from({ length: MAX_BATCH_RECIPIENTS + 1 }, (_, index) => row(index + 1)).join("\n");
  assert.throws(() => parseRecipientsCsv(csv), /a payout batch can hold at most 6 recipients, this CSV has 7/);
});

test("rejects a row with missing columns", () => {
  assert.throws(() => parseRecipientsCsv(`${account()},${asset(1)}`), /row 1 must have address,dest_asset,amount_in/);
});

test("rejects a row with a malformed address or asset", () => {
  assert.throws(
    () => parseRecipientsCsv(`not-an-address,${asset(1)},1000`),
    /row 1: recipient address must be a valid Stellar account address/,
  );
  assert.throws(
    () => parseRecipientsCsv(`${account()},${account()},1000`),
    /row 1: destination asset must be a valid Stellar asset contract address/,
  );
});

test("rejects a row with a non-positive amount", () => {
  assert.throws(() => parseRecipientsCsv(`${account()},${asset(1)},0`), /row 1: amount in must be greater than zero/);
  assert.throws(() => parseRecipientsCsv(`${account()},${asset(1)},-5`), /row 1: amount in must be a whole number/);
});
