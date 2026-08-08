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

export async function fetchQuote(assetIn: string, assetOut: string, amountIn: bigint): Promise<QuotePreview> {
  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetIn, assetOut, amountIn: amountIn.toString() }),
  });
  const data = (await response.json()) as QuoteApiResponse;
  if (!response.ok) {
    throw new Error(data.error ?? `quote request failed with status ${response.status}`);
  }
  return {
    amountOut: BigInt(data.amountOut),
    otherAmountThreshold: BigInt(data.otherAmountThreshold),
    priceImpactPct: data.priceImpactPct,
  };
}

export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new Error("slippageBps must be between 0 and 10000");
  }
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
