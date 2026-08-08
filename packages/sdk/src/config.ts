export type StellarNetwork = "testnet" | "mainnet";

export interface FlowRouteConfig {
  network: StellarNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string | null;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`missing required environment variable: ${key}`);
  }
  return value;
}

function parseNetwork(value: string): StellarNetwork {
  if (value === "testnet" || value === "mainnet") {
    return value;
  }
  throw new Error(`invalid STELLAR_NETWORK value: ${value}, expected testnet or mainnet`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): FlowRouteConfig {
  return {
    network: parseNetwork(requireEnv(env, "STELLAR_NETWORK")),
    rpcUrl: requireEnv(env, "STELLAR_RPC_URL"),
    networkPassphrase: requireEnv(env, "STELLAR_NETWORK_PASSPHRASE"),
    contractId: env.FLOWROUTE_CONTRACT_ID ?? null,
  };
}

export function requireContractId(config: FlowRouteConfig): string {
  if (!config.contractId) {
    throw new Error("FLOWROUTE_CONTRACT_ID is not set, deploy the contract before calling this method");
  }
  return config.contractId;
}
