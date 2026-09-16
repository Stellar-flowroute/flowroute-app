import { serve } from "@hono/node-server";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import { scValToI128 } from "@stellar-flowroute/sdk";
import { Hono } from "hono";
import type { Pool } from "pg";
import { loadIndexerConfig, type IndexerConfig } from "./config.js";
import {
  applySchema,
  createPool,
  getCursor,
  setCursor,
  upsertBatch,
  upsertPayout,
} from "./db.js";

if (process.env.FLOWROUTE_USE_CURL_FETCH === "1") {
  try {
    const { installCurlFetchFallback } = await import(
      "@stellar-flowroute/sdk/dist/curl-fetch-fallback.js"
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
const DEFAULT_PORT = 3001;
// Retries are bounded so a fetch that keeps failing ends the pass instead of hanging inside it. The pass then fails
// without touching the cursor, and the next poll retries the same ledger range from the persisted cursor.
const DEFAULT_MAX_FETCH_ATTEMPTS = 5;

export interface IngestOptions {
  maxFetchAttempts?: number;
  initialBackoffMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, initialBackoffMs: number): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt + 1 >= maxAttempts) {
        throw error;
      }
      const backoff = Math.min(initialBackoffMs * 2 ** attempt, MAX_BACKOFF_MS);
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

// The public RPC only retains a rolling window of ledgers (exposed via getHealth as oldestLedger/latestLedger).
// INDEXER_START_LEDGER is a bootstrap hint, not a guarantee: on a fresh database it names where ingestion would
// ideally start, but if that ledger has already aged out of the RPC's retention window, the RPC will reject it
// outright. In that case a fresh database bootstraps from the RPC's current retained floor instead, and events
// between the configured hint and that floor are permanently unavailable from this endpoint -- they are not
// silently treated as ingested, only skipped with an explicit, logged acknowledgement that they are unrecoverable.
//
// Cursor invariant: the persisted cursor is only written after a pass has fetched every page in its range, processed
// every event in those pages, and paged contiguously. It only ever moves forward, and never past the highest ledger
// the pass actually scanned. A latestLedger reported by RPC is not by itself proof that the ledgers below it were
// ingested, so any failure leaves the cursor untouched and the next pass retries the same range. An existing,
// persisted cursor is never advanced just because the RPC's retention window moved past it -- if the retention floor
// has overtaken a persisted cursor, that is an unscanned gap the worker refuses to paper over, and it fails loudly
// instead.
export async function ingestOnce(
  config: IndexerConfig,
  pool: Pool,
  server: rpc.Server,
  options: IngestOptions = {},
): Promise<void> {
  const maxFetchAttempts = options.maxFetchAttempts ?? DEFAULT_MAX_FETCH_ATTEMPTS;
  const initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;

  const cursorLedger = await getCursor(pool);
  const health = await withRetry(() => server.getHealth(), maxFetchAttempts, initialBackoffMs);

  let startLedger: number;
  if (cursorLedger === null) {
    if (config.startLedger < health.oldestLedger) {
      console.warn(
        `configured INDEXER_START_LEDGER (${config.startLedger}) is older than the RPC's retained floor ` +
          `(${health.oldestLedger}); bootstrapping from the retained floor instead. Events before ledger ` +
          `${health.oldestLedger} are not recoverable from this RPC endpoint.`,
      );
      startLedger = health.oldestLedger;
    } else {
      startLedger = config.startLedger;
    }
  } else {
    startLedger = Number(cursorLedger);
    if (startLedger < health.oldestLedger) {
      throw new Error(
        `persisted cursor is at ledger ${startLedger}, which is older than the RPC's currently retained floor ` +
          `(${health.oldestLedger}); the RPC can no longer serve this range, so whether it holds events cannot be ` +
          `verified. Refusing to silently skip ahead over an unscanned gap -- this requires manual intervention.`,
      );
    }
  }

  let pagingCursor: string | undefined;
  let scannedThrough: number | null = null;

  for (;;) {
    const page = await withRetry(
      () => fetchEventsPage(server, config, startLedger, pagingCursor),
      maxFetchAttempts,
      initialBackoffMs,
    );

    // A node that cannot serve the requested range is not evidence that the range holds no events. Refuse to move the
    // cursor instead of recording coverage the pass never had.
    if (page.latestLedger < startLedger) {
      throw new Error(
        `rpc reported latest ledger ${page.latestLedger}, behind the cursor at ${startLedger}; ` +
          `refusing to advance the cursor over an unscanned ledger range`,
      );
    }

    scannedThrough = scannedThrough === null ? page.latestLedger : Math.max(scannedThrough, page.latestLedger);

    for (const event of page.events) {
      await processEvent(pool, event);
    }

    if (page.events.length < EVENT_PAGE_SIZE) {
      break;
    }

    // A repeated cursor would make the loop spin without covering new ledgers, so treat it as a broken page and stop.
    if (pagingCursor !== undefined && page.cursor === pagingCursor) {
      throw new Error(
        `rpc returned the repeated paging cursor ${page.cursor}; refusing to advance the cursor over an unscanned ledger range`,
      );
    }
    pagingCursor = page.cursor;
  }

  if (scannedThrough === null) {
    return;
  }

  const scanned = BigInt(scannedThrough);
  const nextCursor = cursorLedger !== null && cursorLedger > scanned ? cursorLedger : scanned;
  await setCursor(pool, nextCursor);
}

// Render's Background Worker service type has no free tier, but its Web Service type does, and a
// Web Service only requires that the process bind to a port and answer HTTP requests -- it doesn't
// have to actually be a web server. This endpoint exists solely so this worker can satisfy that
// requirement and deploy as a free Web Service instead of a paid Background Worker.
function startHealthServer(pool: Pool, port: number): void {
  const app = new Hono();
  app.get("/health", async (c) => {
    const lastProcessedLedger = await getCursor(pool);
    return c.json({
      status: "ok",
      lastProcessedLedger: lastProcessedLedger?.toString() ?? null,
    });
  });
  serve({ fetch: app.fetch, port });
  console.log(`flowroute indexer worker health server listening on port ${port}`);
}

export async function runWorker(config: IndexerConfig, pool: Pool = createPool(config)): Promise<void> {
  await applySchema(pool);
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });

  const port = Number(process.env.PORT) || DEFAULT_PORT;
  startHealthServer(pool, port);

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
