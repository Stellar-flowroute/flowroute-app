import { SoroswapSDK, SupportedNetworks, SupportedProtocols, TradeType } from "@soroswap/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { describeQuoteError } from "@/lib/quote-error";

interface QuoteRequestBody {
  assetIn: string;
  assetOut: string;
  amountIn: string;
}

function parseNetwork(value: string | undefined): SupportedNetworks {
  return value === "mainnet" ? SupportedNetworks.MAINNET : SupportedNetworks.TESTNET;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.SOROSWAP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "SOROSWAP_API_KEY is not configured" }, { status: 500 });
  }

  const body = (await request.json()) as Partial<QuoteRequestBody>;
  if (!body.assetIn || !body.assetOut || !body.amountIn) {
    return NextResponse.json({ error: "assetIn, assetOut, and amountIn are required" }, { status: 400 });
  }

  let amount: bigint;
  try {
    amount = BigInt(body.amountIn);
  } catch {
    return NextResponse.json({ error: "amountIn must be an integer" }, { status: 400 });
  }
  if (amount <= 0n) {
    return NextResponse.json({ error: "amountIn must be positive" }, { status: 400 });
  }

  const network = parseNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK);
  const client = new SoroswapSDK({
    apiKey,
    defaultNetwork: network,
  });

  try {
    const quote = await client.quote({
      assetIn: body.assetIn,
      assetOut: body.assetOut,
      amount,
      tradeType: TradeType.EXACT_IN,
      protocols: [SupportedProtocols.SOROSWAP, SupportedProtocols.SDEX, SupportedProtocols.AQUA],
    });
    return NextResponse.json({
      amountOut: quote.amountOut.toString(),
      otherAmountThreshold: quote.otherAmountThreshold.toString(),
      priceImpactPct: quote.priceImpactPct,
    });
  } catch (error) {
    // @soroswap/sdk wraps axios: an upstream error status rejects with the raw response body (not an
    // Error), while a network failure (no response at all) rejects with the original AxiosError, whose
    // `.config` carries this request's own Authorization header. describeQuoteError only ever reads an
    // explicit allowlist of fields out of either shape, so nothing from `.config`/`.request`/arbitrary
    // upstream data can end up in this log line or in the response sent back to the browser.
    const requestId = crypto.randomUUID();
    const info = describeQuoteError(error);
    console.error("[api/quote] upstream quote request failed", {
      requestId,
      assetIn: body.assetIn,
      assetOut: body.assetOut,
      amountIn: body.amountIn,
      network,
      upstreamStatus: info.status,
      upstreamCode: info.code,
      upstreamMessage: info.message,
      upstreamDetails: info.details,
    });
    return NextResponse.json({ error: info.message }, { status: 502 });
  }
}
