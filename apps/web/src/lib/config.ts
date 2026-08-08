import type { FlowRouteConfig, StellarNetwork } from "@stellar-flowroute/sdk";

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

function parseNetwork(value: string): StellarNetwork {
  if (value === "testnet" || value === "mainnet") {
    return value;
  }
  throw new Error(`invalid NEXT_PUBLIC_STELLAR_NETWORK value: ${value}, expected testnet or mainnet`);
}

export function loadWebConfig(): FlowRouteConfig {
  return {
    network: parseNetwork(requireEnv(process.env.NEXT_PUBLIC_STELLAR_NETWORK, "NEXT_PUBLIC_STELLAR_NETWORK")),
    rpcUrl: requireEnv(process.env.NEXT_PUBLIC_STELLAR_RPC_URL, "NEXT_PUBLIC_STELLAR_RPC_URL"),
    networkPassphrase: requireEnv(
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
      "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    ),
    contractId: process.env.NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID ?? null,
  };
}

export function indexerApiUrl(): string {
  return requireEnv(process.env.NEXT_PUBLIC_INDEXER_API_URL, "NEXT_PUBLIC_INDEXER_API_URL");
}
