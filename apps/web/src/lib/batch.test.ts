import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { MAX_BATCH_RECIPIENTS } from "@stellar-flowroute/sdk";
import {
  buildBatch,
  canAddRecipient,
  draftTotalAmountIn,
  parseAmountIn,
  validateBatchSize,
  type RecipientDraft,
} from "./batch";

function account(): string {
  return Keypair.random().publicKey();
}

function asset(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

function draft(overrides: Partial<RecipientDraft> = {}): RecipientDraft {
  return {
    address: account(),
    destAsset: asset(1),
    amountIn: "1000",
    destMin: 900n,
    ...overrides,
  };
}

function drafts(count: number): RecipientDraft[] {
  return Array.from({ length: count }, (_, index) =>
    draft({ destAsset: asset(index + 1), amountIn: String((index + 1) * 1000), destMin: BigInt((index + 1) * 900) }),
  );
}

test("the web app uses the SDK's batch limit", () => {
  assert.equal(MAX_BATCH_RECIPIENTS, 6);
});

test("builds a batch of exactly MAX_BATCH_RECIPIENTS recipients", () => {
  const batch = buildBatch(drafts(MAX_BATCH_RECIPIENTS));
  assert.equal(batch.recipients.length, MAX_BATCH_RECIPIENTS);
  assert.equal(batch.totalSourceAmount, 21_000n);
  assert.equal(typeof batch.totalSourceAmount, "bigint");
  assert.equal(batch.recipients[0]!.amount_in, 1000n);
  assert.equal(batch.recipients[0]!.dest_min, 900n);
});

test("the total is the exact sum of the submitted allocations", () => {
  const input = drafts(3);
  const batch = buildBatch(input);
  const expected = input.reduce((sum, entry) => sum + BigInt(entry.amountIn), 0n);
  assert.equal(batch.totalSourceAmount, expected);
});

test("refuses to add a seventh recipient", () => {
  assert.equal(canAddRecipient(MAX_BATCH_RECIPIENTS - 1), true);
  assert.equal(canAddRecipient(MAX_BATCH_RECIPIENTS), false);
  assert.equal(canAddRecipient(MAX_BATCH_RECIPIENTS + 1), false);
  assert.throws(() => buildBatch(drafts(MAX_BATCH_RECIPIENTS + 1)), /at most 6 recipients, got 7/);
});

test("rejects an empty batch", () => {
  assert.throws(() => buildBatch([]), /add at least one recipient/);
  assert.throws(() => validateBatchSize(0), /add at least one recipient/);
});

test("rejects a non-positive or non-integer amount in", () => {
  assert.throws(() => buildBatch([draft({ amountIn: "0" })]), /amount in must be greater than zero/);
  assert.throws(() => buildBatch([draft({ amountIn: "-100" })]), /whole number of base units/);
  assert.throws(() => buildBatch([draft({ amountIn: "1.5" })]), /whole number of base units/);
  assert.throws(() => buildBatch([draft({ amountIn: "" })]), /whole number of base units/);
  assert.throws(() => buildBatch([draft({ amountIn: "abc" })]), /whole number of base units/);
  assert.throws(() => parseAmountIn("0"), /amount in must be greater than zero/);
});

test("rejects a missing or non-positive minimum received", () => {
  assert.throws(() => buildBatch([draft({ destMin: null })]), /fetch quotes before submitting/);
  assert.throws(() => buildBatch([draft({ destMin: 0n })]), /minimum received must be greater than zero/);
  assert.throws(() => buildBatch([draft({ destMin: -10n })]), /minimum received must be greater than zero/);
});

test("rejects malformed addresses and assets before submitting", () => {
  assert.throws(() => buildBatch([draft({ address: "not-an-address" })]), /valid Stellar account address/);
  assert.throws(() => buildBatch([draft({ address: "" })]), /valid Stellar account address/);
  assert.throws(() => buildBatch([draft({ address: asset(4) })]), /valid Stellar account address/);
  assert.throws(() => buildBatch([draft({ destAsset: account() })]), /valid Stellar asset contract address/);
  assert.throws(() => buildBatch([draft({ destAsset: "Cbogus" })]), /valid Stellar asset contract address/);
});

test("keeps monetary values as bigints above Number.MAX_SAFE_INTEGER", () => {
  const large = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const batch = buildBatch([
    draft({ amountIn: large.toString(), destMin: large - 1n }),
    draft({ amountIn: large.toString(), destMin: large - 1n }),
  ]);
  assert.equal(batch.recipients[0]!.amount_in, large);
  assert.equal(batch.totalSourceAmount, large * 2n);
  assert.equal(batch.totalSourceAmount, 18014398509481984n);
});

test("draftTotalAmountIn previews the running total with bigints", () => {
  assert.equal(draftTotalAmountIn([draft({ amountIn: "1000" }), draft({ amountIn: "500" })]), 1500n);
  assert.equal(typeof draftTotalAmountIn([draft({ amountIn: "1000" })]), "bigint");
  // Rows that are still being typed must not break the preview.
  assert.equal(draftTotalAmountIn([draft({ amountIn: "" }), draft({ amountIn: "0" }), draft({ amountIn: "7" })]), 7n);
});
