import { Address, ScInt, nativeToScVal, scValToBigInt, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { PayoutResult, Recipient } from "./types";

export function i128ToScVal(value: bigint): xdr.ScVal {
  return new ScInt(value, { type: "i128" }).toI128();
}

export function scValToI128(scv: xdr.ScVal): bigint {
  if (scv.switch().name !== "scvI128") {
    throw new Error(`expected an i128 ScVal, got ${scv.switch().name}`);
  }
  return scValToBigInt(scv);
}

// Soroban encodes a struct as an ScMap keyed by Symbol, sorted by field name, hence the explicit per-field type spec below.
export function recipientToScVal(recipient: Recipient): xdr.ScVal {
  return nativeToScVal(
    {
      address: recipient.address,
      amount_in: recipient.amount_in,
      dest_asset: recipient.dest_asset,
      dest_min: recipient.dest_min,
    },
    {
      type: {
        address: ["symbol", "address"],
        amount_in: ["symbol", "i128"],
        dest_asset: ["symbol", "address"],
        dest_min: ["symbol", "i128"],
      },
    },
  );
}

export function recipientsToScVal(recipients: Recipient[]): xdr.ScVal {
  return xdr.ScVal.scvVec(recipients.map(recipientToScVal));
}

function structFields(scv: xdr.ScVal): xdr.ScMapEntry[] {
  if (scv.switch().name !== "scvMap") {
    throw new Error(`expected an scvMap, got ${scv.switch().name}`);
  }
  const entries = scv.map();
  if (!entries) {
    throw new Error("expected a populated scvMap");
  }
  return entries;
}

function structField(entries: xdr.ScMapEntry[], name: string): xdr.ScVal {
  const entry = entries.find((candidate) => scValToNative(candidate.key()) === name);
  if (!entry) {
    throw new Error(`missing field "${name}" in contract struct`);
  }
  return entry.val();
}

export function scValToPayoutResult(scv: xdr.ScVal): PayoutResult {
  const entries = structFields(scv);
  const successScVal = structField(entries, "success");
  if (successScVal.switch().name !== "scvBool") {
    throw new Error(`expected a bool for "success", got ${successScVal.switch().name}`);
  }

  return {
    recipient: Address.fromScVal(structField(entries, "recipient")).toString(),
    success: successScVal.b(),
    amount_delivered: scValToI128(structField(entries, "amount_delivered")),
  };
}

export function scValToPayoutResults(scv: xdr.ScVal): PayoutResult[] {
  if (scv.switch().name !== "scvVec") {
    throw new Error(`expected an scvVec, got ${scv.switch().name}`);
  }
  const vec = scv.vec();
  if (!vec) {
    throw new Error("expected a populated scvVec");
  }
  return vec.map(scValToPayoutResult);
}
