import { serve } from "@hono/node-server";
import { rpc } from "@stellar/stellar-sdk";
import { Hono } from "hono";
import type { Pool } from "pg";
import type { IndexerConfig } from "./config.js";
import { loadIndexerConfig } from "./config.js";
import {
  createPool,
  getBatch,
  getCursor,
  getPayoutsForBatch,
  listBatchesBySender,
  type BatchRow,
  type PayoutRow,
} from "./db.js";

const DEFAULT_PORT = 3001;

interface BatchDto {
  payoutId: string;
  sender: string;
  recipientCount: number;
  successCount: number;
  totalSourceAmount: string;
  ledger: string;
}

interface PayoutDto {
  payoutId: string;
  sender: string;
  recipient: string;
  sourceAsset: string;
  destAsset: string;
  amountDelivered: string;
  success: boolean;
  ledger: string;
}

function batchToDto(batch: BatchRow): BatchDto {
  return {
    payoutId: batch.payoutId.toString(),
    sender: batch.sender,
    recipientCount: batch.recipientCount,
    successCount: batch.successCount,
    totalSourceAmount: batch.totalSourceAmount.toString(),
    ledger: batch.ledger.toString(),
  };
}

function payoutToDto(payout: PayoutRow): PayoutDto {
  return {
    payoutId: payout.payoutId.toString(),
    sender: payout.sender,
    recipient: payout.recipient,
    sourceAsset: payout.sourceAsset,
    destAsset: payout.destAsset,
    amountDelivered: payout.amountDelivered.toString(),
    success: payout.success,
    ledger: payout.ledger.toString(),
  };
}

export function createApi(pool: Pool, server: rpc.Server): Hono {
  const app = new Hono();

  app.get("/batches", async (c) => {
    const sender = c.req.query("sender");
    if (!sender) {
      return c.json({ error: "sender query parameter is required" }, 400);
    }
    const batches = await listBatchesBySender(pool, sender);
    return c.json(batches.map(batchToDto));
  });

  app.get("/batches/:payout_id", async (c) => {
    const raw = c.req.param("payout_id");
    let payoutId: bigint;
    try {
      payoutId = BigInt(raw);
    } catch {
      return c.json({ error: "payout_id must be an integer" }, 400);
    }

    const batch = await getBatch(pool, payoutId);
    if (!batch) {
      return c.json({ error: "batch not found" }, 404);
    }
    const recipients = await getPayoutsForBatch(pool, payoutId);
    return c.json({
      batch: batchToDto(batch),
      recipients: recipients.map(payoutToDto),
    });
  });

  app.get("/health", async (c) => {
    const [lastProcessedLedger, latestLedger] = await Promise.all([
      getCursor(pool),
      server.getLatestLedger(),
    ]);
    const lagLedgers = lastProcessedLedger === null ? null : latestLedger.sequence - Number(lastProcessedLedger);
    return c.json({
      status: "ok",
      lastProcessedLedger: lastProcessedLedger?.toString() ?? null,
      latestLedger: latestLedger.sequence,
      lagLedgers,
    });
  });

  return app;
}

export function startApi(
  config: IndexerConfig,
  pool: Pool = createPool(config),
  port: number = DEFAULT_PORT,
): void {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const app = createApi(pool, server);
  serve({ fetch: app.fetch, port });
  console.log(`flowroute indexer api listening on port ${port}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startApi(loadIndexerConfig());
}
