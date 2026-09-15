import { isValidContractAddress } from "@stellar-flowroute/sdk";

export interface QuotePreview {
  amountOut: bigint;
  otherAmountThreshold: bigint;
  priceImpactPct: string;
}

interface QuoteApiResponse {
  amountOut: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  error?: string;
}

function parseQuoteAmount(value: string | undefined, label: string): bigint {
  if (typeof value !== "string") {
    throw new Error(`quote response is missing ${label}`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new Error(`quote response has a malformed ${label}: ${value}`);
  }
}

export async function fetchQuote(assetIn: string, assetOut: string, amountIn: bigint): Promise<QuotePreview> {
  if (!isValidContractAddress(assetIn)) {
    throw new Error("source asset must be a valid Stellar asset contract address (C...)");
  }
  if (!isValidContractAddress(assetOut)) {
    throw new Error("destination asset must be a valid Stellar asset contract address (C...)");
  }
  if (typeof amountIn !== "bigint" || amountIn <= 0n) {
    throw new Error("amount in must be a positive bigint");
  }

  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetIn, assetOut, amountIn: amountIn.toString() }),
  });
  const data = (await response.json()) as QuoteApiResponse;
  if (!response.ok) {
    throw new Error(data.error ?? `quote request failed with status ${response.status}`);
  }

  const amountOut = parseQuoteAmount(data.amountOut, "amountOut");
  if (amountOut <= 0n) {
    throw new Error("quote returned a non-positive amount out");
  }

  return {
    amountOut,
    otherAmountThreshold: parseQuoteAmount(data.otherAmountThreshold, "otherAmountThreshold"),
    priceImpactPct: data.priceImpactPct,
  };
}

// Reduces a quoted amount out by the sender's slippage tolerance. The contract requires a positive dest_min, so a
// positive quote is never rounded all the way down to zero: the floor is clamped to at least one base unit.
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  if (typeof amountOut !== "bigint" || amountOut <= 0n) {
    throw new Error("amount out must be a positive bigint");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error("slippageBps must be an integer between 0 and 10000");
  }
  const floor = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return floor > 0n ? floor : 1n;
}
