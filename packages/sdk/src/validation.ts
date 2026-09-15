import { StrKey } from "@stellar/stellar-sdk";
import type { Recipient, StellarAddress } from "./types.js";

// The deployed FlowRoute contract rejects a payout batch with more than six recipients. This constant is the single
// source of truth for that limit: the SDK validates against it and the web app imports it for its own checks.
export const MAX_BATCH_RECIPIENTS = 6;

export function isValidStellarAddress(value: unknown): value is StellarAddress {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

export function isValidContractAddress(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidContract(value);
}

// Monetary values are i128 base units. Anything that is not a positive bigint cannot be encoded for the contract, so it
// is rejected before a transaction is built or simulated.
export function assertPositiveAmount(value: unknown, label: string): asserts value is bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${label} must be a bigint, got ${typeof value}`);
  }
  if (value <= 0n) {
    throw new Error(`${label} must be positive, got ${value}`);
  }
}

export function validateRecipients(recipients: readonly Recipient[]): void {
  if (!Array.isArray(recipients)) {
    throw new Error(`recipients must be an array, got ${typeof recipients}`);
  }
  if (recipients.length === 0) {
    throw new Error("a payout batch needs at least one recipient");
  }
  if (recipients.length > MAX_BATCH_RECIPIENTS) {
    throw new Error(
      `a payout batch can hold at most ${MAX_BATCH_RECIPIENTS} recipients, got ${recipients.length}`,
    );
  }

  recipients.forEach((recipient, index) => {
    const label = `recipient ${index + 1}`;
    if (!isValidStellarAddress(recipient.address)) {
      throw new Error(`${label} has an invalid Stellar account address: ${String(recipient.address)}`);
    }
    if (!isValidContractAddress(recipient.dest_asset)) {
      throw new Error(`${label} has an invalid destination asset address: ${String(recipient.dest_asset)}`);
    }
    assertPositiveAmount(recipient.amount_in, `${label} amount_in`);
    assertPositiveAmount(recipient.dest_min, `${label} dest_min`);
  });
}

export function sumRecipientAmounts(recipients: readonly Recipient[]): bigint {
  return recipients.reduce((sum, recipient) => sum + recipient.amount_in, 0n);
}

// The contract pulls total_source_amount in one transfer and reverts unless it equals the sum of every recipient's
// amount_in, so the SDK derives nothing here: it only checks that the caller's total matches the allocations exactly.
export function validateTotalSourceAmount(
  totalSourceAmount: unknown,
  recipients: readonly Recipient[],
): asserts totalSourceAmount is bigint {
  if (typeof totalSourceAmount !== "bigint") {
    throw new Error(`totalSourceAmount must be a bigint, got ${typeof totalSourceAmount}`);
  }
  assertPositiveAmount(totalSourceAmount, "totalSourceAmount");
  const total = sumRecipientAmounts(recipients);
  if (totalSourceAmount !== total) {
    throw new Error(
      `totalSourceAmount (${totalSourceAmount}) must equal the sum of recipient allocations (${total})`,
    );
  }
}

export interface ExecuteBatchValidationInput {
  sender: StellarAddress;
  sourceAsset: StellarAddress;
  recipients: readonly Recipient[];
  totalSourceAmount: unknown;
}

// Runs before any RPC call: a malformed address, asset, amount, or total is rejected locally instead of being sent to
// the network for a simulation that can only fail.
export function validateExecuteBatchParams(params: ExecuteBatchValidationInput): void {
  if (!isValidStellarAddress(params.sender)) {
    throw new Error(`sender must be a valid Stellar account address, got ${String(params.sender)}`);
  }
  if (!isValidContractAddress(params.sourceAsset)) {
    throw new Error(`sourceAsset must be a valid Stellar asset contract address, got ${String(params.sourceAsset)}`);
  }
  validateRecipients(params.recipients);
  validateTotalSourceAmount(params.totalSourceAmount, params.recipients);
}
