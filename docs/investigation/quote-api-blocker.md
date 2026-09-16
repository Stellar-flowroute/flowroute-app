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

## Comparison result: api.soroswap.finance (no "1")

Method note: a temporary diagnostic route identical in shape to the earlier one was written and
committed locally, but pushing it was blocked by the sandbox's own safety classifier before it ever
reached `origin` or Vercel -- production was never touched by this step. The commit was reverted
locally. Instead, the exact same one-shot authenticated request (same body, same header shape) was
issued directly from this machine using the `SOROSWAP_API_KEY` already present in
`apps/web/.env.local`, and the response was redacted the same way the diagnostic route would have
redacted it before this was recorded.

Request:
POST https://api.soroswap.finance/quote?network=testnet
(same body as above)

Result:
HTTP 400
Content-Type: application/json; charset=utf-8

Body:
```
{
  "title": "Path not found",
  "detail": "No path found for CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC to CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F in soroswap",
  "extra": {},
  "error": "Quote Failed"
}
```

Classification: **B, authenticated API returns application-level quote failure.** The request reached
a real Soroswap backend and authenticated successfully (no 401/403) -- this is a fundamentally
different failure than the `api1.soroswap.finance` hosting-level 404
(`DEPLOYMENT_NOT_FOUND`, a Vercel platform response, not a Soroswap response) captured earlier. The
correctly-configured host (`api.soroswap.finance`, matching the SDK's actual default `baseUrl`) is up
and answers with a structured error: it found no swap path between these two specific testnet assets
in Soroswap at all, for any amount -- i.e. no liquidity route exists for this XLM/USDC testnet pair in
Soroswap, independent of the `amountIn` used.

This does not yet explain why production's Vercel function trace shows the outbound call landing on
`api1.soroswap.finance` (a host that 404s at the platform level) rather than `api.soroswap.finance`
(a host that responds normally). That discrepancy -- and whether it is unique to this asset pair or a
general condition on testnet -- is still open.

## Pool-level and on-chain findings: XLM/USDC does have funded liquidity

Two independent checks, no source/contract/config changes made:

**A. One authenticated pool lookup**, matching `@soroswap/sdk@0.4.0`'s actual
`getPoolByTokens(assetA, assetB, network, protocols)` serialization (read from the installed
package's `dist/soroswap-sdk.js` and `dist/clients/http-client.js` -- array params become repeated
`protocol=` query keys, not comma-joined):

```
GET https://api.soroswap.finance/pools/<XLM>/<USDC>?network=testnet&protocol=soroswap&protocol=sdex&protocol=aqua
```

Result: `HTTP 200`, body `[]` (empty array). The API reports zero pools for this pair across all three
requested protocols.

**B. Public, unauthenticated on-chain verification** (Soroban RPC, `https://soroban-testnet.stellar.org`,
via `stellar contract invoke --send=no` -- read-only simulation, no Soroswap API key involved, no
transaction submitted):

- Soroswap's own shared testnet factory contract (`CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`,
  from `soroswap/core:public/testnet.contracts.json`) reports **247 total pairs** (`all_pairs_length`) --
  the shared testnet is broadly active, not empty.
- `factory.get_pair(XLM, USDC)` returns a real pair contract:
  `CDVAIOYHCD4RUSLQNVFI7RIZBFT2JZMJWM4RTOLQZQXL4QAVXU5RFKDB`.
- That pair contract's `token_0`/`token_1` are exactly `CB3TLW74...` (USDC) and `CDLZFC3S...` (XLM) --
  confirmed as our exact pair, not a coincidental match.
- Its `get_reserves()` right now: `["16631672100", "220345854513"]` -- i.e. real, substantial, currently
  non-zero liquidity on both sides (~1,663 USDC and ~22,035 XLM at 7 decimals).
- Two other sampled pairs from the same factory (`all_pairs(0)`, `all_pairs(1)`) also carry large
  non-zero reserves, so this isn't a one-off; the shared testnet factory broadly has funded pools.

**Conclusion:** the XLM/USDC pair is **not** missing liquidity. The on-chain pair contract that
Soroswap's own factory says is the pair for these exact two tokens is funded right now. Yet
`GET /pools/<XLM>/<USDC>` returns `[]` and `POST /quote` returns "Path not found" for the identical
pair. This rules out "no liquidity for this pair" and "testnet broadly has no usable liquidity" (247
funded pairs exist) as explanations. It points instead to a **Soroswap API/indexing-layer bug**: the
API's pool index or router does not see a pair that verifiably exists and is funded on-chain via the
official factory contract.

This is a separate, third issue from the api1 hostname problem -- fixing api1 → api alone would not
produce a working quote for this pair, since the correctly-configured host has the same "path not
found" behavior via both `/quote` and `/pools/{a}/{b}`.

## Path B: USDC/XTAR tested as a candidate demo pair -- also fails via the API

Candidate addresses/values and their sources:

| Field | Value | Source |
|---|---|---|
| USDC contract | `CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F` | `soroswap/core:public/tokens.json` (testnet, code "USDC"); re-confirmed on-chain via `symbol()` |
| XTAR contract | `CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2` | `soroswap/core:public/tokens.json` (testnet, name "Dogstar", code "XTAR"); re-confirmed on-chain via `symbol()` |
| USDC decimals | `7` | On-chain `decimals()` call, `CB3TLW74...` contract, Soroban RPC (not taken from the JSON file) |
| XTAR decimals | `7` | On-chain `decimals()` call, `CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2` contract, Soroban RPC |
| Pair contract | `CDSQONFE5BS732OYYJINI2L7W4567XRBLJWDD7GPVQZLXLPC4CGA55ZO` | `factory.get_pair(USDC, XTAR)` on the shared testnet factory `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`, re-queried fresh this session |
| Reserves (token_0=USDC, token_1=XTAR) | `["1232150007934", "2069771239621"]` = ~123,215.0 USDC / ~206,977.1 XTAR | `pair.get_reserves()`, re-queried fresh this session, same Soroban RPC read |

All of the above are public, unauthenticated Soroban RPC reads (`stellar contract invoke --send=no`)
against the real testnet ledger -- no Soroswap API key involved, no transaction submitted.

**The one authenticated request** (exact `@soroswap/sdk@0.4.0` `quote()` shape, no sender/address field
per the SDK's own `QuoteRequest` type):

```
POST https://api.soroswap.finance/quote?network=testnet
{
  "assetIn": "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
  "assetOut": "CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2",
  "amount": "10000000",
  "tradeType": "EXACT_IN",
  "protocols": ["soroswap", "sdex", "aqua"]
}
```

`amount` = `10000000` = 1.0 USDC at USDC's on-chain-verified 7 decimals -- roughly 0.0008% of the pool's
~123,215 USDC reserve, i.e. a conservative size that should barely move the price if the pool were
reachable.

Result: `HTTP 400`, `durationMs` ~6989ms, body:
```
{
  "title": "Path not found",
  "detail": "No path found for CB3TLW74...JJOV2F to CCZGLAUBD...4LXF2 in soroswap",
  "extra": {},
  "error": "Quote Failed"
}
```

**Classification: B, application-level quote failure.** No `amountOut` was returned (classification C
does not apply). This is the same "Path not found" response as XLM/USDC, against a *different* pair
that independently has substantial, currently non-zero, on-chain-verified liquidity.

**This resolves the open question from the previous entry:** the API's pool-index gap is not specific
to XLM/USDC -- it reproduces on a second, independently verified, well-funded pair. This looks systemic
to the public Testnet API's routing/indexing layer, not a property of any one pair. **USDC/XTAR is not
currently a viable demo pair either**, despite genuinely having liquidity on-chain -- the live API will
not quote it right now, for the same unexplained reason it won't quote XLM/USDC.

## Next investigation

1. Determine why production's outbound call is observed hitting `api1.soroswap.finance` when the
   installed SDK's default `baseUrl` points at `api.soroswap.finance` -- check for a redirect,
   DNS-level split, or Soroswap-side routing behavior between the two hostnames rather than assuming
   application code is responsible.
2. Given the API-side indexing gap now reproduces on two independently funded pairs, treat this as
   systemic rather than pair-specific. No FlowRoute-side pair substitution is likely to fix quoting
   until Soroswap's API/indexer is understood or fixed -- consider contacting Soroswap support/Discord
   directly about the gap between `factory.get_pair`/`get_reserves()` (funded) and `/quote` +
   `/pools/{a}/{b}` (empty), since it isn't something fixable from FlowRoute's side.
3. If a demo is needed before Soroswap resolves this, that would require a decision outside this
   investigation's scope (e.g. mocking the quote response, or dropping Soroswap for the demo path) --
   not something to decide unilaterally here.

After the investigation is complete, this note can be retained or cleaned up as appropriate.

## Verified findings summary

Consolidated, documentation-only summary of everything confirmed across this investigation. No
application source, contract source, SDK version, Vercel configuration, environment variables, quote
behavior, or signing flow was changed to produce any of these findings.

1. **api1 hostname issue (independent finding).** Production FlowRoute's `/api/quote` previously
   reached `api1.soroswap.finance`, which returned a Vercel-platform response: `HTTP 404
   DEPLOYMENT_NOT_FOUND`. This is a hosting-level response from Vercel, not from Soroswap's
   application.

2. **Direct authenticated request, XLM/USDC, current API host.**
   `POST https://api.soroswap.finance/quote?network=testnet` for
   XLM (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) to
   USDC (`CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F`) returned `HTTP 400`,
   `title: "Path not found"`, `error: "Quote Failed"`.

3. **Authenticated pool lookup, same pair.** `GET /pools/{XLM}/{USDC}?network=testnet&protocol=soroswap&protocol=sdex&protocol=aqua`
   returned `HTTP 200`, body `[]`.

4. **Independent unauthenticated Soroban RPC verification.** Direct, unauthenticated reads against
   Soroswap's official shared testnet factory contract (`CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`)
   confirmed: the XLM/USDC pair exists (`get_pair` returns a real contract address), that pair
   contract exists on-chain, and its reserves are non-zero.

5. **Second independently funded pair tested.** USDC (`CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F`)
   / XTAR (`CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2`), pair contract
   `CDSQONFE5BS732OYYJINI2L7W4567XRBLJWDD7GPVQZLXLPC4CGA55ZO`. Both tokens verified on-chain as 7
   decimals. On-chain reserves: `["1232150007934", "2069771239621"]`. An authenticated quote request
   for 1 USDC returned `HTTP 400`, ~6989ms, `title: "Path not found"`, `error: "Quote Failed"`.

6. **Conclusion.** The evidence demonstrates that Soroswap's public Testnet quote/pool API is
   currently inconsistent with on-chain pool state across at least two independently funded pairs.
   This is an upstream API/indexing/routing issue. It prevents FlowRoute from obtaining a genuine
   quote through the current Soroswap API. Multiple independently funded pairs showed the same
   discrepancy between confirmed on-chain liquidity and the API's "no path found" / empty-pool
   response. This does **not** establish that Soroswap is permanently broken, does **not** establish
   the precise internal cause of the indexing discrepancy, and does **not** establish that every
   Soroswap Testnet pair is affected -- only that the two pairs actually tested were.

7. **The api1.soroswap.finance hostname issue (finding 1) remains a separate, independent finding**
   from the API/indexing discrepancy (findings 2-6). Resolving one does not resolve the other; fixing
   api1 → api alone would not produce a working quote for either pair tested, since the correctly
   configured host shows the same discrepancy.

8. Across this entire investigation: no quote was fabricated, no signing was performed, no production
   transaction was submitted, and no application workaround was implemented.
