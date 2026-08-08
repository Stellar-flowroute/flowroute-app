"use client";

import { Fragment, useState } from "react";
import { truncateAddress } from "@/lib/format";
import {
  fetchBatchDetail,
  fetchBatchesBySender,
  type BatchDetail,
  type BatchSummary,
} from "@/lib/indexer";

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";

export default function HistoryPage() {
  const [sender, setSender] = useState("");
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadHistory() {
    if (!sender) {
      setError("enter a sender address");
      return;
    }
    setError(null);
    setLoading(true);
    setExpandedPayoutId(null);
    setDetail(null);
    try {
      const result = await fetchBatchesBySender(sender);
      setBatches(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load history");
    } finally {
      setLoading(false);
    }
  }

  async function toggleDetail(payoutId: string) {
    if (expandedPayoutId === payoutId) {
      setExpandedPayoutId(null);
      setDetail(null);
      return;
    }
    setExpandedPayoutId(payoutId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await fetchBatchDetail(payoutId);
      setDetail(result);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "failed to load batch");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settlement history</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 min-w-[280px] flex-col gap-1 text-sm">
          Sender address
          <input
            className={inputClass}
            value={sender}
            onChange={(event) => setSender(event.target.value)}
            placeholder="G..."
          />
        </label>
        <button
          type="button"
          onClick={loadHistory}
          disabled={loading}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0b0f14] disabled:opacity-60"
        >
          {loading ? "Loading..." : "Load history"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {batches ? (
        batches.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No payout runs found for this sender.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="p-2">Payout</th>
                  <th className="p-2">Recipients</th>
                  <th className="p-2">Succeeded</th>
                  <th className="p-2">Total source amount</th>
                  <th className="p-2">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <Fragment key={batch.payoutId}>
                    <tr
                      onClick={() => toggleDetail(batch.payoutId)}
                      className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                    >
                      <td className="p-2">#{batch.payoutId}</td>
                      <td className="p-2">{batch.recipientCount}</td>
                      <td className="p-2">
                        {batch.successCount}/{batch.recipientCount}
                      </td>
                      <td className="p-2">{batch.totalSourceAmount}</td>
                      <td className="p-2">{batch.ledger}</td>
                    </tr>
                    {expandedPayoutId === batch.payoutId ? (
                      <tr className="border-b border-[var(--color-border)]">
                        <td colSpan={5} className="p-3">
                          {detailLoading ? (
                            <p className="text-sm text-[var(--color-text-muted)]">Loading recipients...</p>
                          ) : detailError ? (
                            <p className="text-sm text-red-500">{detailError}</p>
                          ) : detail ? (
                            <table className="w-full min-w-[600px] text-left text-sm">
                              <thead className="text-[var(--color-text-muted)]">
                                <tr>
                                  <th className="p-1">Recipient</th>
                                  <th className="p-1">Dest asset</th>
                                  <th className="p-1">Success</th>
                                  <th className="p-1">Amount delivered</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.recipients.map((recipient) => (
                                  <tr key={recipient.recipient}>
                                    <td className="p-1">{truncateAddress(recipient.recipient)}</td>
                                    <td className="p-1">{truncateAddress(recipient.destAsset)}</td>
                                    <td className="p-1">{recipient.success ? "yes" : "no"}</td>
                                    <td className="p-1">{recipient.amountDelivered}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
