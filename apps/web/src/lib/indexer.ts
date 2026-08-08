import { indexerApiUrl } from "@/lib/config";

export interface BatchSummary {
  payoutId: string;
  sender: string;
  recipientCount: number;
  successCount: number;
  totalSourceAmount: string;
  ledger: string;
}

export interface PayoutDetail {
  payoutId: string;
  sender: string;
  recipient: string;
  sourceAsset: string;
  destAsset: string;
  amountDelivered: string;
  success: boolean;
  ledger: string;
}

export interface BatchDetail {
  batch: BatchSummary;
  recipients: PayoutDetail[];
}

async function indexerFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${indexerApiUrl()}${path}`);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `indexer request failed with status ${response.status}`);
  }
  return body;
}

export function fetchBatchesBySender(sender: string): Promise<BatchSummary[]> {
  return indexerFetch<BatchSummary[]>(`/batches?sender=${encodeURIComponent(sender)}`);
}

export function fetchBatchDetail(payoutId: string): Promise<BatchDetail> {
  return indexerFetch<BatchDetail>(`/batches/${encodeURIComponent(payoutId)}`);
}
