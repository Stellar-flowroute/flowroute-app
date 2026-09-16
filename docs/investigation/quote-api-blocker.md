# FlowRoute Quote API Investigation

## Current production status

- Vercel Production deployment is working.
- Current application source is clean and pushed.
- Current final cleanup commit:
  4e4ddd35e7744420d415d77c3f702ef9dfa748ac
  chore(web): remove temporary quote diagnostic
- The temporary /api/quote-diagnostic route has been removed.

## Confirmed /api/quote behavior

Production:
POST /api/quote
XLM:
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
USDC:
CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F
amountIn:
100000000

Production response:
HTTP 502
error:
Quote Failed

The temporary diagnostic response also showed:
upstreamMessage:
Quote Failed

No upstream HTTP status/code was exposed through the SDK path.

## Direct authenticated diagnostic finding

Using the real Production environment inside Vercel, the temporary diagnostic route made one authenticated request to:

https://api1.soroswap.finance/quote?network=testnet

Result:
HTTP 404
Content-Type: text/plain; charset=utf-8

Body:
The deployment could not be found on Vercel.
DEPLOYMENT_NOT_FOUND

This indicates api1.soroswap.finance returned a Vercel hosting-level 404 during the test.

## Important SDK/API observation

The temporary diagnostic route was pointed at:
https://api1.soroswap.finance

to match the external call target observed in Vercel's function trace for the production /api/quote invocation.

Correction verified directly against the installed package source (`@soroswap/sdk@0.4.0`, `dist/soroswap-sdk.js`): the SDK's own default `baseUrl` is:
https://api.soroswap.finance

(no "1"). `apps/web/src/app/api/quote/route.ts` never passes a `baseUrl` override to `new SoroswapSDK(...)`, so the installed SDK, as actually configured in this app, calls `api.soroswap.finance`, not `api1.soroswap.finance`. The "api1" hostname seen in Vercel's trace is therefore not something our code or the SDK specifies -- it is most likely Soroswap's own backend/proxy shard that `api.soroswap.finance` resolves or forwards to, observed at the network layer rather than the application layer.

This has NOT yet been proven to be the root cause. It is not yet established whether `api.soroswap.finance` (the SDK's actual configured target) and `api1.soroswap.finance` (the hostname observed in the trace and used by the temporary diagnostic) behave the same, differently, or are simply the same backend reached two different ways.

## Next investigation

Perform a ONE-request authenticated comparison against:

https://api.soroswap.finance/quote?network=testnet

using the exact same request shape as @soroswap/sdk@0.4.0:

```
{
  "assetIn": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "assetOut": "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
  "amount": "100000000",
  "tradeType": "EXACT_IN",
  "protocols": ["soroswap", "sdex", "aqua"]
}
```

Use the Production SOROSWAP_API_KEY only inside the secure runtime where it already exists.

NEVER print, log, commit, or report the API key or Authorization header.

Classify the result:
A. authenticated API returns HTTP error
B. authenticated API returns application-level quote failure
C. authenticated API returns a usable quote
D. transport/network failure

After the investigation is complete, this note can be retained or cleaned up as appropriate.
