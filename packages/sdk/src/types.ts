// Field names match the contract's Rust struct fields exactly, Soroban encodes a struct as an ScVal map keyed by field name.
export type StellarAddress = string;

export interface Recipient {
  address: StellarAddress;
  dest_asset: StellarAddress;
  dest_min: bigint;
  amount_in: bigint;
}

export interface PayoutResult {
  recipient: StellarAddress;
  success: boolean;
  amount_delivered: bigint;
}
