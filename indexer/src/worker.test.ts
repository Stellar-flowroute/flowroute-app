import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { i128ToScVal } from "@stellar-flowroute/sdk";
import { parseBatchEvent, parsePayoutEvent } from "./worker";

function baseEvent(topic: xdr.ScVal[], value: xdr.ScVal): rpc.Api.EventResponse {
  return {
    id: "0000000001-0000000000",
    type: "contract",
    ledger: 12345,
    ledgerClosedAt: new Date().toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "a".repeat(64),
    topic,
    value,
  };
}

test("parses a payout event", () => {
  const sender = Keypair.random().publicKey();
  const recipient = Keypair.random().publicKey();
  const sourceAsset = Keypair.random().publicKey();
  const destAsset = Keypair.random().publicKey();
  const amountDelivered = BigInt(Number.MAX_SAFE_INTEGER) + 42n;

  const event = baseEvent(
    [
      xdr.ScVal.scvSymbol("payout"),
      xdr.ScVal.scvU64(new xdr.Uint64(7)),
      nativeToScVal(sender, { type: "address" }),
    ],
    xdr.ScVal.scvVec([
      nativeToScVal(recipient, { type: "address" }),
      nativeToScVal(sourceAsset, { type: "address" }),
      nativeToScVal(destAsset, { type: "address" }),
      i128ToScVal(amountDelivered),
      xdr.ScVal.scvBool(true),
    ]),
  );

  assert.deepEqual(parsePayoutEvent(event), {
    payoutId: 7n,
    sender,
    recipient,
    sourceAsset,
    destAsset,
    amountDelivered,
    success: true,
  });
});

test("parses a batch event", () => {
  const sender = Keypair.random().publicKey();
  const totalSourceAmount = BigInt(Number.MAX_SAFE_INTEGER) + 1_000n;

  const event = baseEvent(
    [
      xdr.ScVal.scvSymbol("batch"),
      xdr.ScVal.scvU64(new xdr.Uint64(9)),
      nativeToScVal(sender, { type: "address" }),
    ],
    xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(2), i128ToScVal(totalSourceAmount)]),
  );

  assert.deepEqual(parseBatchEvent(event), {
    payoutId: 9n,
    sender,
    recipientCount: 3,
    successCount: 2,
    totalSourceAmount,
  });
});

test("rejects a payout event with a mismatched data tuple length", () => {
  const event = baseEvent(
    [xdr.ScVal.scvSymbol("payout"), xdr.ScVal.scvU64(new xdr.Uint64(1)), nativeToScVal(Keypair.random().publicKey(), { type: "address" })],
    xdr.ScVal.scvVec([xdr.ScVal.scvBool(true)]),
  );
  assert.throws(() => parsePayoutEvent(event));
});
