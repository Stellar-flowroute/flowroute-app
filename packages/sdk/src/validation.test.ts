import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, StrKey, type rpc } from "@stellar/stellar-sdk";
import { executeBatch } from "./client.js";
import type { FlowRouteConfig } from "./config.js";
import type { Recipient } from "./types.js";
import {
  MAX_BATCH_RECIPIENTS,
  assertPositiveAmount,
  isValidContractAddress,
  isValidStellarAddress,
  sumRecipientAmounts,
  validateExecuteBatchParams,
  validateRecipients,
  validateTotalSourceAmount,
} from "./validation.js";

function account(): string {
  return Keypair.random().publicKey();
}

// A syntactically valid Stellar asset contract address, distinct per seed.
function assetContract(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

function recipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    address: account(),
    dest_asset: assetContract(1),
    dest_min: 900n,
    amount_in: 1000n,
    ...overrides,
  };
}

// A batch whose allocations sum exactly to the stated total.
function batchOf(count: number): { recipients: Recipient[]; totalSourceAmount: bigint } {
  const recipients = Array.from({ length: count }, (_, index) =>
    recipient({
      dest_asset: assetContract(index + 1),
      amount_in: BigInt(index + 1) * 100n,
      dest_min: BigInt(index + 1) * 90n,
    }),
  );
  return { recipients, totalSourceAmount: sumRecipientAmounts(recipients) };
}

test("MAX_BATCH_RECIPIENTS matches the contract's batch limit", () => {
  assert.equal(MAX_BATCH_RECIPIENTS, 6);
});

test("accepts a batch of exactly MAX_BATCH_RECIPIENTS recipients", () => {
  const { recipients, totalSourceAmount } = batchOf(MAX_BATCH_RECIPIENTS);
  assert.doesNotThrow(() => validateRecipients(recipients));
  assert.doesNotThrow(() => validateTotalSourceAmount(totalSourceAmount, recipients));
});

test("rejects a batch with more than MAX_BATCH_RECIPIENTS recipients", () => {
  const { recipients } = batchOf(MAX_BATCH_RECIPIENTS + 1);
  assert.throws(() => validateRecipients(recipients), /at most 6 recipients, got 7/);
});

test("rejects an empty batch", () => {
  assert.throws(() => validateRecipients([]), /at least one recipient/);
});

test("rejects a zero amount_in", () => {
  assert.throws(
    () => validateRecipients([recipient({ amount_in: 0n })]),
    /recipient 1 amount_in must be positive, got 0/,
  );
});

test("rejects a negative amount_in", () => {
  assert.throws(() => validateRecipients([recipient({ amount_in: -1n })]), /recipient 1 amount_in must be positive/);
});

test("rejects a zero dest_min", () => {
  assert.throws(
    () => validateRecipients([recipient({ dest_min: 0n })]),
    /recipient 1 dest_min must be positive, got 0/,
  );
});

test("rejects a negative dest_min", () => {
  assert.throws(() => validateRecipients([recipient({ dest_min: -100n })]), /recipient 1 dest_min must be positive/);
});

test("rejects non-bigint monetary values", () => {
  const numberAmount = recipient({ amount_in: 1000 as unknown as bigint });
  assert.throws(() => validateRecipients([numberAmount]), /recipient 1 amount_in must be a bigint, got number/);

  assert.throws(() => assertPositiveAmount("1000", "amount_in"), /amount_in must be a bigint, got string/);
  assert.throws(() => assertPositiveAmount(null, "dest_min"), /dest_min must be a bigint, got object/);
});

test("rejects a malformed recipient address", () => {
  assert.throws(() => validateRecipients([recipient({ address: "not-an-address" })]), /invalid Stellar account address/);
  assert.throws(() => validateRecipients([recipient({ address: "" })]), /invalid Stellar account address/);
  // A contract address is not a valid recipient address.
  assert.throws(() => validateRecipients([recipient({ address: assetContract(9) })]), /invalid Stellar account address/);
});

test("rejects a malformed destination asset", () => {
  // An account address is not a valid asset contract address.
  assert.throws(() => validateRecipients([recipient({ dest_asset: account() })]), /invalid destination asset address/);
  assert.throws(() => validateRecipients([recipient({ dest_asset: "Cnotavalid" })]), /invalid destination asset address/);
});

test("rejects a total_source_amount that is not the sum of allocations", () => {
  const { recipients, totalSourceAmount } = batchOf(2);
  assert.throws(
    () => validateTotalSourceAmount(totalSourceAmount + 1n, recipients),
    /must equal the sum of recipient allocations/,
  );
  assert.throws(
    () => validateTotalSourceAmount(totalSourceAmount - 100n, recipients),
    /must equal the sum of recipient allocations/,
  );
});

test("rejects a total_source_amount that is not a positive bigint", () => {
  const { recipients } = batchOf(2);
  assert.throws(() => validateTotalSourceAmount(300 as unknown as bigint, recipients), /must be a bigint, got number/);
  assert.throws(() => validateTotalSourceAmount("300", recipients), /must be a bigint, got string/);
  assert.throws(() => validateTotalSourceAmount(0n, recipients), /totalSourceAmount must be positive, got 0/);
});

test("keeps the summed total as a bigint above Number.MAX_SAFE_INTEGER", () => {
  const large = BigInt(Number.MAX_SAFE_INTEGER) + 1_000_000n;
  const recipients = [recipient({ amount_in: large, dest_min: large - 1n })];
  assert.equal(sumRecipientAmounts(recipients), large);
  assert.equal(typeof sumRecipientAmounts(recipients), "bigint");
  assert.doesNotThrow(() => validateTotalSourceAmount(large, recipients));
});

test("address helpers only accept the matching Stellar strkey type", () => {
  assert.equal(isValidStellarAddress(account()), true);
  assert.equal(isValidStellarAddress(assetContract(1)), false);
  assert.equal(isValidStellarAddress(""), false);
  assert.equal(isValidContractAddress(assetContract(1)), true);
  assert.equal(isValidContractAddress(account()), false);
  assert.equal(isValidContractAddress(undefined), false);
});

test("validateExecuteBatchParams validates sender, source asset, recipients, and the total", () => {
  const { recipients, totalSourceAmount } = batchOf(1);
  assert.doesNotThrow(() =>
    validateExecuteBatchParams({
      sender: account(),
      sourceAsset: assetContract(20),
      recipients,
      totalSourceAmount,
    }),
  );

  assert.throws(
    () =>
      validateExecuteBatchParams({
        sender: "bogus",
        sourceAsset: assetContract(20),
        recipients,
        totalSourceAmount,
      }),
    /sender must be a valid Stellar account address/,
  );

  assert.throws(
    () =>
      validateExecuteBatchParams({
        sender: account(),
        sourceAsset: account(),
        recipients,
        totalSourceAmount,
      }),
    /sourceAsset must be a valid Stellar asset contract address/,
  );

  assert.throws(
    () =>
      validateExecuteBatchParams({
        sender: account(),
        sourceAsset: assetContract(20),
        recipients: batchOf(MAX_BATCH_RECIPIENTS + 1).recipients,
        totalSourceAmount,
      }),
    /at most 6 recipients/,
  );
});

const baseConfig: FlowRouteConfig = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: assetContract(99),
};

// A server stub that fails loudly if the SDK reaches the network, proving validation happens before simulation.
function unnetworkedServer(): { server: rpc.Server; wasCalled: () => boolean } {
  let called = false;
  const server = {
    getAccount: async () => {
      called = true;
      throw new Error("getAccount should not be reached: the batch must be rejected before simulation");
    },
  } as unknown as rpc.Server;
  return { server, wasCalled: () => called };
}

test("executeBatch rejects an oversized batch before simulating", async () => {
  const { recipients, totalSourceAmount } = batchOf(MAX_BATCH_RECIPIENTS + 1);
  const { server, wasCalled } = unnetworkedServer();
  await assert.rejects(
    () =>
      executeBatch(
        baseConfig,
        { sender: account(), sourceAsset: assetContract(20), recipients, totalSourceAmount, signTransaction: async () => "" },
        server,
      ),
    /at most 6 recipients, got 7/,
  );
  assert.equal(wasCalled(), false);
});

test("executeBatch rejects malformed addresses and assets before simulating", async () => {
  const { recipients, totalSourceAmount } = batchOf(2);

  const badSender = unnetworkedServer();
  await assert.rejects(
    () =>
      executeBatch(
        baseConfig,
        {
          sender: "not-an-address",
          sourceAsset: assetContract(20),
          recipients,
          totalSourceAmount,
          signTransaction: async () => "",
        },
        badSender.server,
      ),
    /sender must be a valid Stellar account address/,
  );
  assert.equal(badSender.wasCalled(), false);

  const badAsset = unnetworkedServer();
  await assert.rejects(
    () =>
      executeBatch(
        baseConfig,
        {
          sender: account(),
          sourceAsset: recipients[0]!.address,
          recipients,
          totalSourceAmount,
          signTransaction: async () => "",
        },
        badAsset.server,
      ),
    /sourceAsset must be a valid Stellar asset contract address/,
  );
  assert.equal(badAsset.wasCalled(), false);
});

test("executeBatch rejects a mismatched total before simulating", async () => {
  const { recipients, totalSourceAmount } = batchOf(2);
  const { server, wasCalled } = unnetworkedServer();
  await assert.rejects(
    () =>
      executeBatch(
        baseConfig,
        { sender: account(), sourceAsset: assetContract(20), recipients, totalSourceAmount: totalSourceAmount + 1n, signTransaction: async () => "" },
        server,
      ),
    /must equal the sum of recipient allocations/,
  );
  assert.equal(wasCalled(), false);
});

test("executeBatch rejects non-positive amounts before simulating", async () => {
  const { recipients, totalSourceAmount } = batchOf(1);
  const { server, wasCalled } = unnetworkedServer();
  const zeroAmount = [{ ...recipients[0]!, amount_in: 0n }];
  await assert.rejects(
    () =>
      executeBatch(
        baseConfig,
        {
          sender: account(),
          sourceAsset: assetContract(20),
          recipients: zeroAmount,
          totalSourceAmount,
          signTransaction: async () => "",
        },
        server,
      ),
    /recipient 1 amount_in must be positive/,
  );
  assert.equal(wasCalled(), false);
});
