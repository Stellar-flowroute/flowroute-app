"use client";

import { executeBatch, type PayoutResult, type Recipient } from "@stellar-flowroute/sdk";
import { useMemo, useState, type ChangeEvent } from "react";
import { parseRecipientsCsv } from "@/lib/csv";
import { loadWebConfig } from "@/lib/config";
import { truncateAddress } from "@/lib/format";
import { applySlippage, fetchQuote } from "@/lib/quote";
import { connectWallet, signWithFreighter } from "@/lib/wallet";

interface RecipientRow {
  id: string;
  address: string;
  destAsset: string;
  amountIn: string;
  destMin: bigint | null;
  amountOutPreview: bigint | null;
  priceImpactPct: string | null;
  quoting: boolean;
  quoteError: string | null;
}

function newRow(): RecipientRow {
  return {
    id: crypto.randomUUID(),
    address: "",
    destAsset: "",
    amountIn: "",
    destMin: null,
    amountOutPreview: null,
    priceImpactPct: null,
    quoting: false,
    quoteError: null,
  };
}

type SubmitStatus = "idle" | "simulating" | "awaiting-signature" | "submitting" | "success" | "error";

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";

export default function PayoutPage() {
  const [sourceAsset, setSourceAsset] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [rows, setRows] = useState<RecipientRow[]>([newRow()]);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<PayoutResult[] | null>(null);

  const totalSourceAmount = useMemo(() => {
    return rows.reduce((sum, row) => {
      try {
        return sum + BigInt(row.amountIn || "0");
      } catch {
        return sum;
      }
    }, 0n);
  }, [rows]);

  function updateRow(id: string, patch: Partial<RecipientRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, newRow()]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseRecipientsCsv(text);
      setRows(
        parsed.map((entry) => ({
          ...newRow(),
          address: entry.address,
          destAsset: entry.destAsset,
          amountIn: entry.amountIn,
        })),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "failed to parse CSV");
    }
  }

  async function getQuotes() {
    if (!sourceAsset) {
      setSubmitError("source asset is required before fetching quotes");
      return;
    }
    setSubmitError(null);
    for (const row of rows) {
      if (!row.destAsset || !row.amountIn) {
        continue;
      }
      updateRow(row.id, { quoting: true, quoteError: null });
      try {
        const amountIn = BigInt(row.amountIn);
        const preview = await fetchQuote(sourceAsset, row.destAsset, amountIn);
        const destMin = applySlippage(preview.amountOut, slippageBps);
        updateRow(row.id, {
          quoting: false,
          amountOutPreview: preview.amountOut,
          priceImpactPct: preview.priceImpactPct,
          destMin,
        });
      } catch (err) {
        updateRow(row.id, {
          quoting: false,
          quoteError: err instanceof Error ? err.message : "quote failed",
        });
      }
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    setResults(null);

    if (!sourceAsset) {
      setSubmitError("source asset is required");
      return;
    }
    const recipients: Recipient[] = [];
    for (const row of rows) {
      if (!row.address || !row.destAsset || !row.amountIn || row.destMin === null) {
        setSubmitError("every recipient needs an address, destination asset, amount, and a fetched quote");
        return;
      }
      recipients.push({
        address: row.address,
        dest_asset: row.destAsset,
        dest_min: row.destMin,
        amount_in: BigInt(row.amountIn),
      });
    }
    if (recipients.length === 0) {
      setSubmitError("add at least one recipient");
      return;
    }

    try {
      let sender = address;
      if (!sender) {
        sender = await connectWallet();
        setAddress(sender);
      }

      setStatus("simulating");
      const config = loadWebConfig();
      const payoutResults = await executeBatch(config, {
        sender,
        sourceAsset,
        recipients,
        totalSourceAmount,
        signTransaction: async (xdr, opts) => {
          setStatus("awaiting-signature");
          const signed = await signWithFreighter(xdr, opts);
          setStatus("submitting");
          return signed;
        },
      });

      setResults(payoutResults);
      setStatus("success");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "payout failed");
      setStatus("error");
    }
  }

  const busy = status === "simulating" || status === "awaiting-signature" || status === "submitting";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New payout</h1>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Source asset (contract address)
          <input
            className={inputClass}
            value={sourceAsset}
            onChange={(event) => setSourceAsset(event.target.value)}
            placeholder="C..."
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Slippage tolerance (bps)
          <input
            type="number"
            min={0}
            max={10000}
            className={inputClass}
            value={slippageBps}
            onChange={(event) => setSlippageBps(Number(event.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Upload recipients CSV
          <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="text-sm" />
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
            <tr>
              <th className="p-2">Recipient</th>
              <th className="p-2">Destination asset</th>
              <th className="p-2">Amount in</th>
              <th className="p-2">Expected out</th>
              <th className="p-2">Min received</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="p-2">
                  <input
                    className={inputClass}
                    value={row.address}
                    onChange={(event) => updateRow(row.id, { address: event.target.value })}
                    placeholder="G..."
                  />
                </td>
                <td className="p-2">
                  <input
                    className={inputClass}
                    value={row.destAsset}
                    onChange={(event) => updateRow(row.id, { destAsset: event.target.value })}
                    placeholder="C..."
                  />
                </td>
                <td className="p-2">
                  <input
                    className={inputClass}
                    value={row.amountIn}
                    onChange={(event) => updateRow(row.id, { amountIn: event.target.value })}
                    placeholder="base units"
                  />
                </td>
                <td className="p-2 text-[var(--color-text-muted)]">
                  {row.quoting
                    ? "quoting..."
                    : row.quoteError
                      ? <span className="text-red-500">{row.quoteError}</span>
                      : row.amountOutPreview !== null
                        ? `${row.amountOutPreview.toString()} (impact ${row.priceImpactPct}%)`
                        : "n/a"}
                </td>
                <td className="p-2 text-[var(--color-text-muted)]">{row.destMin?.toString() ?? "n/a"}</td>
                <td className="p-2">
                  <button type="button" onClick={() => removeRow(row.id)} className="text-red-500 hover:underline">
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"
        >
          Add recipient
        </button>
        <button
          type="button"
          onClick={getQuotes}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"
        >
          Get quotes
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0b0f14] disabled:opacity-60"
        >
          {status === "simulating" && "Simulating..."}
          {status === "awaiting-signature" && "Waiting for signature..."}
          {status === "submitting" && "Submitting..."}
          {(status === "idle" || status === "success" || status === "error") && "Simulate and sign"}
        </button>
        <span className="text-sm text-[var(--color-text-muted)]">
          Total source amount: {totalSourceAmount.toString()}
        </span>
      </div>

      {submitError ? <p className="text-sm text-red-500">{submitError}</p> : null}

      {results ? (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <tr>
                <th className="p-2">Recipient</th>
                <th className="p-2">Success</th>
                <th className="p-2">Amount delivered</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.recipient} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="p-2">{truncateAddress(result.recipient)}</td>
                  <td className="p-2">{result.success ? "yes" : "no"}</td>
                  <td className="p-2">{result.amount_delivered.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
