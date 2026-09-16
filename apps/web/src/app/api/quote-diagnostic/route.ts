import { NextResponse } from "next/server";

// TEMPORARY diagnostic route. Not wired into any UI, not the production quote path -- it exists only to
// observe the raw wire response from Soroswap's API directly (bypassing @soroswap/sdk's axios wrapper),
// since /api/quote's SDK-mediated 502 only ever surfaced a bare "Quote Failed" message. Delete this file
// once the underlying Soroswap failure is diagnosed; it fixes no behavior and should not ship.
//
// Request shape reproduced exactly from the installed @soroswap/sdk@0.4.0 (dist/soroswap-sdk.js's
// quote(), dist/clients/http-client.js's HttpClient): POST <baseUrl>/quote?network=<network>, header
// `Authorization: Bearer <apiKey>`, body { assetIn, assetOut, amount: <string>, tradeType, protocols }.
// The SDK's amount is a bigint, JSON-stringified to a string by its custom transformRequest -- this route
// sends the pre-stringified literal "100000000" to match that wire format exactly, not a JSON number.

const UPSTREAM_URL = "https://api1.soroswap.finance/quote?network=testnet";

const DIAGNOSTIC_REQUEST_BODY = {
  assetIn: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  assetOut: "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
  amount: "100000000",
  tradeType: "EXACT_IN",
  protocols: ["soroswap", "sdex", "aqua"],
};

// Second line of defense: even inside an already-limited response body, scrub anything under a
// sensitive-looking key before it can be returned.
const SENSITIVE_KEY_PATTERN = /auth|cookie|token|secret|password|private|seed|key/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      out[key] = typeof entryValue === "object" && entryValue !== null ? redact(entryValue, depth + 1) : entryValue;
    }
    return out;
  }
  return value;
}

export async function POST() {
  const apiKey = process.env.SOROSWAP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "SOROSWAP_API_KEY is not configured" }, { status: 500 });
  }

  const startedAt = Date.now();

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Never included in any log line or response below -- only ever attached to this one outgoing
        // request.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(DIAGNOSTIC_REQUEST_BODY),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return NextResponse.json(
      {
        transport: "failed",
        message: error instanceof Error ? error.message : "request failed before receiving a response",
        durationMs,
      },
      { status: 502 },
    );
  }

  const durationMs = Date.now() - startedAt;
  const contentType = upstreamResponse.headers.get("content-type") ?? "";

  let bodyText = "";
  try {
    bodyText = await upstreamResponse.text();
  } catch {
    // fall through with an empty body
  }

  let body: unknown;
  if (contentType.includes("application/json") && bodyText) {
    try {
      body = redact(JSON.parse(bodyText));
    } catch {
      body = "[response body was not valid JSON]";
    }
  } else {
    // Cap plain-text bodies so nothing unexpectedly large comes back.
    body = bodyText.slice(0, 2000);
  }

  return NextResponse.json({
    upstreamStatus: upstreamResponse.status,
    upstreamContentType: contentType,
    durationMs,
    body,
  });
}
