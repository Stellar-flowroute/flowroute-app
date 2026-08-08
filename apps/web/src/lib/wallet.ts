import { isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import type { SignTransaction } from "@stellar-flowroute/sdk";

export async function isFreighterAvailable(): Promise<boolean> {
  const result = await isConnected();
  return !result.error && result.isConnected;
}

export async function connectWallet(): Promise<string> {
  const result = await requestAccess();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.address;
}

export const signWithFreighter: SignTransaction = async (transactionXdr, opts) => {
  const result = await signTransaction(transactionXdr, { networkPassphrase: opts.networkPassphrase });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.signedTxXdr;
};
