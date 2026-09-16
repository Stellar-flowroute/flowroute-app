import assert from "node:assert/strict";
import test from "node:test";
import { loadIndexerConfig } from "./config.js";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/flowroute",
  DATABASE_SSL: "0",
  FLOWROUTE_CONTRACT_ID: "CBB3UVMGMFVWLF6ZVMQYRQDWOXZUWNW4SD6SERG3RMLFXMWLZNOZ767U",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  INDEXER_START_LEDGER: "0",
};

test("loads a valid config", () => {
  const config = loadIndexerConfig(validEnv);
  assert.equal(config.databaseUrl, validEnv.DATABASE_URL);
  assert.equal(config.contractId, validEnv.FLOWROUTE_CONTRACT_ID);
  assert.equal(config.startLedger, 0);
});

test("missing required variables throw a plain, catchable error", () => {
  const { DATABASE_URL: _drop, ...rest } = validEnv;
  assert.throws(() => loadIndexerConfig(rest), /DATABASE_URL/);
});

test("a malformed start ledger throws instead of producing NaN", () => {
  assert.throws(
    () => loadIndexerConfig({ ...validEnv, INDEXER_START_LEDGER: "not-a-number" }),
    /invalid INDEXER_START_LEDGER/,
  );
});

test("a negative start ledger throws", () => {
  assert.throws(
    () => loadIndexerConfig({ ...validEnv, INDEXER_START_LEDGER: "-1" }),
    /invalid INDEXER_START_LEDGER/,
  );
});
