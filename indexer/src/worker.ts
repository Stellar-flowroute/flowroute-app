import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { scValToI128 } from "@stellar-flowroute/sdk";
import type { Pool } from "pg";
import { loadIndexerConfig, type IndexerConfig } from "./config";
import {
  applySchema,
  createPool,
  getCursor,
  setCursor,
  upsertBatch,
  upsertPayout,
} from "./db";

if (process.env.FLOWROUTE_USE_CURL_FETCH === "1") {
  try {
    const { installCurlFetchFallback } = await import(
      "@stellar-flowroute/sdk/src/curl-fetch-fallback"
    );
    installCurlFetchFallback();
  } catch (error) {
    console.warn(
      "FLOWROUTE_USE_CURL_FETCH is set but the curl fetch fallback module could not be loaded; continuing without it",
      error,
    );
  }
}

const EVENT_PAGE_SIZE = 200;
const POLL_INTERVAL_MS = 5_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
      console.error(`rpc call failed, retrying in ${backoff}ms`, error);
      await sleep(backoff);
    }
  }
}

function decodeSymbol(scv: xdr.ScVal): string {
  if (scv.switch().name !== "scvSymbol") {
    throw new Error(`expected an scvSymbol, got ${scv.switch().name}`);
  }
  return scv.sym().toString();
}

function decodeAddress(scv: xdr.ScVal): string {
  return Address.fromScVal(scv).toString();
}

function decodeBool(scv: xdr.ScVal): boolean {
  if (scv.switch().name !== "scvBool") {
    throw new Error(`expected an scvBool, got ${scv.switch().name}`);
  }
  return scv.b();
}

function decodeU32(scv: xdr.ScVal): number {
  if (scv.switch().name !== "scvU32") {
    throw new Error(`expected an scvU32, got ${scv.switch().name}`);
  }
  return scv.u32();
}

function decodeU64(scv: xdr.ScVal): bigint {
  if (scv.switch().name !== "scvU64") {
    throw new Error(`expected an scvU64, got ${scv.switch().name}`);
  }
  return scv.u64().toBigInt();
}

// Soroban encodes a Rust tuple as an ScVec of its elements in order, which is how event data for a fixed shape is published.
function decodeTuple(scv: xdr.ScVal, length: number): xdr.ScVal[] {
  if (scv.switch().name !== "scvVec") {
    throw new Error(`expected an scvVec, got ${scv.switch().name}`);
  }
  const vec = scv.vec();
  if (!vec || vec.length !== length) {
    throw new Error(`expected a tuple of length ${length}, got ${vec?.length ?? 0}`);
  }
  return vec;
}

export interface PayoutEvent {
  payoutId: bigint;
  sender: string;
  recipient: string;
  sourceAsset: string;
  destAsset: string;
  amountDelivered: bigint;
  success: boolean;
}

export interface BatchEvent {
  payoutId: bigint;
  sender: string;
  recipientCount: number;
  successCount: number;
  totalSourceAmount: bigint;
}

export function parsePayoutEvent(event: rpc.Api.EventResponse): PayoutEvent {
  const [, payoutIdScVal, senderScVal] = event.topic;
  if (!payoutIdScVal || !senderScVal) {
    throw new Error(`payout event ${event.id} is missing topic fields`);
  }
  const [recipientScVal, sourceAssetScVal, destAssetScVal, amountScVal, successScVal] = decodeTuple(event.value, 5);
  return {
    payoutId: decodeU64(payoutIdScVal),
    sender: decodeAddress(senderScVal),
    recipient: decodeAddress(recipientScVal!),
    sourceAsset: decodeAddress(sourceAssetScVal!),
    destAsset: decodeAddress(destAssetScVal!),
    amountDelivered: scValToI128(amountScVal!),
    success: decodeBool(successScVal!),
  };
}

export function parseBatchEvent(event: rpc.Api.EventResponse): BatchEvent {
  const [, payoutIdScVal, senderScVal] = event.topic;
  if (!payoutIdScVal || !senderScVal) {
    throw new Error(`batch event ${event.id} is missing topic fields`);
  }
  const [recipientCountScVal, successCountScVal, totalSourceAmountScVal] = decodeTuple(event.value, 3);
  return {
    payoutId: decodeU64(payoutIdScVal),
    sender: decodeAddress(senderScVal),
    recipientCount: decodeU32(recipientCountScVal!),
    successCount: decodeU32(successCountScVal!),
    totalSourceAmount: scValToI128(totalSourceAmountScVal!),
  };
}

async function processEvent(pool: Pool, event: rpc.Api.EventResponse): Promise<void> {
  const kindScVal = event.topic[0];
  if (!kindScVal) {
    return;
  }

  const kind = decodeSymbol(kindScVal);
  if (kind === "payout") {
    const parsed = parsePayoutEvent(event);
    await upsertPayout(pool, { ...parsed, ledger: BigInt(event.ledger) });
  } else if (kind === "batch") {
    const parsed = parseBatchEvent(event);
    await upsertBatch(pool, { ...parsed, ledger: BigInt(event.ledger) });
  }
}

function fetchEventsPage(
  server: rpc.Server,
  config: IndexerConfig,
  startLedger: number,
  cursor: string | undefined,
): Promise<rpc.Api.GetEventsResponse> {
  const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds: [config.contractId] }];
  if (cursor !== undefined) {
    return server.getEvents({ filters, cursor, limit: EVENT_PAGE_SIZE });
  }
  return server.getEvents({ filters, startLedger, limit: EVENT_PAGE_SIZE });
}

export async function ingestOnce(config: IndexerConfig, pool: Pool, server: rpc.Server): Promise<void> {
  const cursorLedger = await getCursor(pool);
  const startLedger = cursorLedger === null ? config.startLedger : Number(cursorLedger);

  let pagingCursor: string | undefined;
  let highestLedgerProcessed = cursorLedger;
  let sawEvents = false;
  let latestKnownLedger: number | null = null;

  for (;;) {
    const page = await withRetry(() => fetchEventsPage(server, config, startLedger, pagingCursor));
    latestKnownLedger = page.latestLedger;

    for (const event of page.events) {
      await processEvent(pool, event);
      sawEvents = true;
      const ledger = BigInt(event.ledger);
      if (highestLedgerProcessed === null || ledger > highestLedgerProcessed) {
        highestLedgerProcessed = ledger;
      }
    }

    if (page.events.length < EVENT_PAGE_SIZE) {
      break;
    }
    pagingCursor = page.cursor;
  }

  if (sawEvents && highestLedgerProcessed !== null) {
    await setCursor(pool, highestLedgerProcessed);
  } else if (latestKnownLedger !== null) {
    await setCursor(pool, BigInt(latestKnownLedger));
  }
}

export async function runWorker(config: IndexerConfig, pool: Pool = createPool(config)): Promise<void> {
  await applySchema(pool);
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });

  for (;;) {
    try {
      await ingestOnce(config, pool, server);
    } catch (error) {
      console.error("ingestion pass failed, will retry next poll", error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runWorker(loadIndexerConfig()).catch((error: unknown) => {
    console.error("indexer worker crashed", error);
    process.exit(1);
  });
}
