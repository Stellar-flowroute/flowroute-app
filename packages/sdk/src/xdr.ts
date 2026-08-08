import { ScInt, scValToBigInt, xdr } from "@stellar/stellar-sdk";

export function i128ToScVal(value: bigint): xdr.ScVal {
  return new ScInt(value, { type: "i128" }).toI128();
}

export function scValToI128(scv: xdr.ScVal): bigint {
  if (scv.switch().name !== "scvI128") {
    throw new Error(`expected an i128 ScVal, got ${scv.switch().name}`);
  }
  return scValToBigInt(scv);
}
