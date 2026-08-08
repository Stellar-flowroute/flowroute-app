export interface IndexerConfig {
  databaseUrl: string;
  contractId: string;
  rpcUrl: string;
  startLedger: number;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`missing required environment variable: ${key}`);
  }
  return value;
}

export function loadIndexerConfig(env: Record<string, string | undefined> = process.env): IndexerConfig {
  const startLedger = Number(requireEnv(env, "INDEXER_START_LEDGER"));
  if (!Number.isInteger(startLedger) || startLedger < 0) {
    throw new Error(`invalid INDEXER_START_LEDGER value: ${env.INDEXER_START_LEDGER}`);
  }

  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    contractId: requireEnv(env, "FLOWROUTE_CONTRACT_ID"),
    rpcUrl: requireEnv(env, "STELLAR_RPC_URL"),
    startLedger,
  };
}
