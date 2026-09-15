import {
  MAX_BATCH_RECIPIENTS,
  isValidContractAddress,
  isValidStellarAddress,
  type Recipient,
} from "@stellar-flowroute/sdk";

export interface RecipientDraft {
  address: string;
  destAsset: string;
  amountIn: string;
  destMin: bigint | null;
}

export function validateSourceAsset(value: string): void {
  if (!isValidContractAddress(value)) {
    throw new Error("source asset must be a valid Stellar asset contract address (C...)");
  }
}

export function validateRecipientAddress(value: string): void {
  if (!isValidStellarAddress(value)) {
    throw new Error("recipient address must be a valid Stellar account address (G...)");
  }
}

export function validateDestinationAsset(value: string): void {
  if (!isValidContractAddress(value)) {
    throw new Error("destination asset must be a valid Stellar asset contract address (C...)");
  }
}

// Base units only: a whole, positive number. bigint is used from here on so no monetary value passes through a float.
export function parseAmountIn(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("amount in must be a whole number of base units");
  }
  const amount = BigInt(trimmed);
  if (amount <= 0n) {
    throw new Error("amount in must be greater than zero");
  }
  return amount;
}

export function canAddRecipient(count: number): boolean {
  return count < MAX_BATCH_RECIPIENTS;
}

export function validateBatchSize(count: number): void {
  if (count === 0) {
    throw new Error("add at least one recipient");
  }
  if (count > MAX_BATCH_RECIPIENTS) {
    throw new Error(`a payout batch can hold at most ${MAX_BATCH_RECIPIENTS} recipients, got ${count}`);
  }
}

export function validateDestMin(value: bigint | null): bigint {
  if (value === null) {
    throw new Error("fetch quotes before submitting");
  }
  if (value <= 0n) {
    throw new Error("minimum received must be greater than zero");
  }
  return value;
}

export function toRecipient(draft: RecipientDraft): Recipient {
  validateRecipientAddress(draft.address);
  validateDestinationAsset(draft.destAsset);
  const amountIn = parseAmountIn(draft.amountIn);
  const destMin = validateDestMin(draft.destMin);
  return {
    address: draft.address,
    dest_asset: draft.destAsset,
    dest_min: destMin,
    amount_in: amountIn,
  };
}

export interface BuiltBatch {
  recipients: Recipient[];
  totalSourceAmount: bigint;
}

// The total is always derived from the same allocations that are submitted, so the two can never drift apart.
export function buildBatch(drafts: readonly RecipientDraft[]): BuiltBatch {
  validateBatchSize(drafts.length);
  const recipients = drafts.map(toRecipient);
  const totalSourceAmount = recipients.reduce((sum, entry) => sum + entry.amount_in, 0n);
  return { recipients, totalSourceAmount };
}

// Live preview of the running total, tolerating rows that are still being typed.
export function draftTotalAmountIn(drafts: readonly RecipientDraft[]): bigint {
  return drafts.reduce((sum, draft) => {
    try {
      return sum + parseAmountIn(draft.amountIn);
    } catch {
      return sum;
    }
  }, 0n);
}
