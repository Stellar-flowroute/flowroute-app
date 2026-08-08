import { SoroswapSDK, SupportedNetworks, SupportedProtocols, TradeType } from "@soroswap/sdk";
import { NextResponse, type NextRequest } from "next/server";

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

  const client = new SoroswapSDK({
    apiKey,
    defaultNetwork: parseNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK),
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
    const message = error instanceof Error ? error.message : "quote request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
