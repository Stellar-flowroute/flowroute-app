import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { IndexerConfig } from "./config";

export interface PayoutRow {
  payoutId: bigint;
  sender: string;
  recipient: string;
  sourceAsset: string;
  destAsset: string;
  amountDelivered: bigint;
  success: boolean;
  ledger: bigint;
}

export interface BatchRow {
  payoutId: bigint;
  sender: string;
  recipientCount: number;
  successCount: number;
  totalSourceAmount: bigint;
  ledger: bigint;
}

interface PayoutColumns {
  payout_id: string;
  sender: string;
  recipient: string;
  source_asset: string;
  dest_asset: string;
  amount_delivered: string;
  success: boolean;
  ledger: string;
}

interface BatchColumns {
  payout_id: string;
  sender: string;
  recipient_count: number;
  success_count: number;
  total_source_amount: string;
  ledger: string;
}

function rowToPayout(row: PayoutColumns): PayoutRow {
  return {
    payoutId: BigInt(row.payout_id),
    sender: row.sender,
    recipient: row.recipient,
    sourceAsset: row.source_asset,
    destAsset: row.dest_asset,
    amountDelivered: BigInt(row.amount_delivered),
    success: row.success,
    ledger: BigInt(row.ledger),
  };
}

function rowToBatch(row: BatchColumns): BatchRow {
  return {
    payoutId: BigInt(row.payout_id),
    sender: row.sender,
    recipientCount: row.recipient_count,
    successCount: row.success_count,
    totalSourceAmount: BigInt(row.total_source_amount),
    ledger: BigInt(row.ledger),
  };
}

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function createPool(config: IndexerConfig): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(readFileSync(schemaPath, "utf8"));
}

export async function getCursor(pool: Pool): Promise<bigint | null> {
  const result = await pool.query<{ last_ledger: string }>("select last_ledger from cursor where id = 1");
  const row = result.rows[0];
  return row ? BigInt(row.last_ledger) : null;
}

export async function setCursor(pool: Pool, lastLedger: bigint): Promise<void> {
  await pool.query(
    `insert into cursor (id, last_ledger) values (1, $1)
     on conflict (id) do update set last_ledger = excluded.last_ledger`,
    [lastLedger.toString()],
  );
}

export async function upsertPayout(pool: Pool, row: PayoutRow): Promise<void> {
  await pool.query(
    `insert into payouts (payout_id, sender, recipient, source_asset, dest_asset, amount_delivered, success, ledger)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (payout_id, recipient) do update set
       sender = excluded.sender,
       source_asset = excluded.source_asset,
       dest_asset = excluded.dest_asset,
       amount_delivered = excluded.amount_delivered,
       success = excluded.success,
       ledger = excluded.ledger`,
    [
      row.payoutId.toString(),
      row.sender,
      row.recipient,
      row.sourceAsset,
      row.destAsset,
      row.amountDelivered.toString(),
      row.success,
      row.ledger.toString(),
    ],
  );
}

export async function upsertBatch(pool: Pool, row: BatchRow): Promise<void> {
  await pool.query(
    `insert into batches (payout_id, sender, recipient_count, success_count, total_source_amount, ledger)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (payout_id) do update set
       sender = excluded.sender,
       recipient_count = excluded.recipient_count,
       success_count = excluded.success_count,
       total_source_amount = excluded.total_source_amount,
       ledger = excluded.ledger`,
    [
      row.payoutId.toString(),
      row.sender,
      row.recipientCount,
      row.successCount,
      row.totalSourceAmount.toString(),
      row.ledger.toString(),
    ],
  );
}

export async function listBatchesBySender(pool: Pool, sender: string): Promise<BatchRow[]> {
  const result = await pool.query<BatchColumns>(
    `select payout_id, sender, recipient_count, success_count, total_source_amount, ledger
     from batches where sender = $1 order by payout_id desc`,
    [sender],
  );
  return result.rows.map(rowToBatch);
}

export async function getBatch(pool: Pool, payoutId: bigint): Promise<BatchRow | null> {
  const result = await pool.query<BatchColumns>(
    `select payout_id, sender, recipient_count, success_count, total_source_amount, ledger
     from batches where payout_id = $1`,
    [payoutId.toString()],
  );
  const row = result.rows[0];
  return row ? rowToBatch(row) : null;
}

export async function getPayoutsForBatch(pool: Pool, payoutId: bigint): Promise<PayoutRow[]> {
  const result = await pool.query<PayoutColumns>(
    `select payout_id, sender, recipient, source_asset, dest_asset, amount_delivered, success, ledger
     from payouts where payout_id = $1 order by recipient`,
    [payoutId.toString()],
  );
  return result.rows.map(rowToPayout);
}
