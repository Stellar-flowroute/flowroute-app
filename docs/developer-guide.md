# Developer guide

This page covers local setup for `flowroute-app` and the SDK and indexer API surfaces you build against.

## Local setup

1. Install dependencies from the repo root:

   ```
   pnpm install
   ```

2. Create the three `.env.local` files from their examples:

   ```
   cp packages/sdk/.env.example packages/sdk/.env.local
   cp indexer/.env.example indexer/.env.local
   cp apps/web/.env.example apps/web/.env.local
   ```

3. The `.env.example` files already point at the current verified testnet contract (see [Contract reference](contract-reference.md)), so the copied files work as-is; `packages/sdk` and `apps/web` also fall back to that deployment when the contract ID is left unset. Set `DATABASE_URL` in `indexer/.env.local` to your local Postgres connection string, and `SOROSWAP_API_KEY` in `apps/web/.env.local` if you want the payout page's quote feature to work. The indexer requires `FLOWROUTE_CONTRACT_ID` to be set explicitly; keep it at the example value unless you are indexing a different deployment.

4. Start Postgres locally, for example with Docker.

5. Run the indexer worker, the indexer API, and the web app, each in its own terminal, in whichever order suits your workflow. The worker follows FlowRoute contract events into Postgres, the API serves that data, and the web app reads from the API for settlement history.

### Environment variables

`packages/sdk/.env.example` and `indexer/.env.example` share:

```
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
FLOWROUTE_CONTRACT_ID=CBB3UVMGMFVWLF6ZVMQYRQDWOXZUWNW4SD6SERG3RMLFXMWLZNOZ767U
```

`FLOWROUTE_CONTRACT_ID` is the current FlowRoute Router deployment on testnet. In `packages/sdk`, `loadConfig` falls back to `DEFAULT_FLOWROUTE_CONTRACT_ID`, which holds the same address, when the variable is unset; leaving it empty (`FLOWROUTE_CONTRACT_ID=`) in a loaded `.env.local` still throws, so an environment can opt out of the default deliberately. `indexer` has no default and requires the variable.

`indexer/.env.example` additionally has:

```
DATABASE_URL=postgres://user:password@localhost:5432/flowroute
DATABASE_SSL=0
INDEXER_START_LEDGER=0
```

## `INDEXER_START_LEDGER`

`INDEXER_START_LEDGER` is a bootstrap hint for a fresh database, not a guaranteed starting point. It only matters when the `cursor` table is empty (`getCursor` returns `null`) -- once a cursor is persisted, ingestion always resumes from there instead.

The public RPC only retains a rolling window of ledgers, reported by `getHealth()` as `oldestLedger`/`latestLedger`. `ingestOnce` in `indexer/src/worker.ts` calls `getHealth()` at the start of every pass and compares it against the configured or persisted ledger:

- **Fresh database** (`cursor` is `null`): if `INDEXER_START_LEDGER` is older than the RPC's current `oldestLedger`, the worker logs a warning and bootstraps from `oldestLedger` instead. Events older than that floor are not recoverable from this RPC endpoint -- the worker never claims they were ingested. `0` is a safe default for this value precisely because it always falls back to whatever the RPC currently retains; it does not mean "index from ledger zero."
- **Existing database** (`cursor` is already populated): the persisted cursor is never advanced automatically just because the retention window moved past it. If the RPC's `oldestLedger` has overtaken the persisted cursor, the pass fails with an explicit error instead of silently skipping the gap -- this needs manual attention, since it means real history may be unrecoverable from this RPC.

`apps/web/.env.example`:

```
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID=CBB3UVMGMFVWLF6ZVMQYRQDWOXZUWNW4SD6SERG3RMLFXMWLZNOZ767U
NEXT_PUBLIC_INDEXER_API_URL=http://localhost:3001
SOROSWAP_API_KEY=
```

`NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID` is the same current testnet deployment, and `loadWebConfig` falls back to `DEFAULT_FLOWROUTE_CONTRACT_ID` from `packages/sdk` when it is unset.

`SOROSWAP_API_KEY` is only needed for the payout page's quote preview, which calls the Soroswap SDK server-side from `apps/web/src/app/api/quote/route.ts`.

## `DATABASE_SSL`

Render's managed Postgres requires SSL and rejects plain connections. A local Postgres, for example the Docker instance used in local setup, typically does not speak SSL at all.

Setting `DATABASE_SSL=1` makes `createPool` in `indexer/src/db.ts` pass `ssl: { rejectUnauthorized: false }` to the `pg` `Pool` config, matching Render's documented connection pattern. It is off by default, which is correct for local development. Set it to `1` in the indexer's Render environment.

## `FLOWROUTE_USE_CURL_FETCH`

On some machines, Node's built-in fetch fails to reach `soroban-testnet.stellar.org` with a connection timeout, even though `curl` reaches the same host from the same machine without issue. This is a narrow, machine-specific networking incompatibility, not a general problem with the RPC host.

Setting `FLOWROUTE_USE_CURL_FETCH=1` installs a fetch override that shells out to `curl` for requests to the configured RPC host. It is off by default. It is unlikely to be needed in a hosted environment, since Node's networking has not shown this issue there.

## SDK reference

Real exports from `packages/sdk/src/index.ts`:

### `createRpcServer(config: FlowRouteConfig): rpc.Server`

Builds a Soroban RPC server client from a `FlowRouteConfig`.

### `getPayoutCount(config: FlowRouteConfig, server?: rpc.Server): Promise<bigint>`

Simulates a call to the contract's `get_payout_count` and returns the result. `server` defaults to a fresh `createRpcServer(config)` call if omitted.

### `executeBatch(config: FlowRouteConfig, params: ExecuteBatchParams, server?: rpc.Server): Promise<PayoutResult[]>`

Builds, simulates, signs, submits, and polls an `execute_batch` transaction to completion, returning the per-recipient results the contract returns.

```
interface ExecuteBatchParams {
  sender: StellarAddress;
  sourceAsset: StellarAddress;
  recipients: Recipient[];
  totalSourceAmount: bigint;
  signTransaction: SignTransaction;
}

type SignTransaction = (
  transactionXdr: string,
  opts: { networkPassphrase: string },
) => Promise<string>;
```

`signTransaction` is wallet-agnostic: it takes an unsigned transaction XDR and must return the signed transaction XDR. `apps/web` implements this with Freighter.

`executeBatch` validates the batch locally before it touches the network. It rejects a list longer than `MAX_BATCH_RECIPIENTS` (6), an empty list, a malformed sender or `sourceAsset`, a malformed recipient address or `dest_asset`, a non-bigint, zero, or negative `amount_in` or `dest_min`, and a `totalSourceAmount` that is not exactly the sum of the recipient allocations. Every monetary value stays a `bigint` in base units; nothing is converted through a float.

Also exported for callers that validate their own input, like the web app: `MAX_BATCH_RECIPIENTS`, `isValidStellarAddress`, `isValidContractAddress`, `assertPositiveAmount`, `validateRecipients`, `validateTotalSourceAmount`, `sumRecipientAmounts`, and `validateExecuteBatchParams`.

Also exported: `loadConfig`, `requireContractId`, `DEFAULT_FLOWROUTE_CONTRACT_ID` (the current verified testnet deployment), the `FlowRouteConfig` and `StellarNetwork` types, the `Recipient` and `PayoutResult` types, and the low-level XDR conversion helpers (`i128ToScVal`, `scValToI128`, `recipientToScVal`, `recipientsToScVal`, `scValToPayoutResult`, `scValToPayoutResults`).

## API reference

The indexer's read API, from `indexer/src/api.ts`:

### `GET /batches?sender=<address>`

Returns every batch for a given sender. `sender` is required.

Example response:

```json
[
  {
    "payoutId": "1",
    "sender": "GABC...",
    "recipientCount": 3,
    "successCount": 2,
    "totalSourceAmount": "10000000",
    "ledger": "123456"
  }
]
```

### `GET /batches/:payout_id`

Returns one batch and its per-recipient outcomes.

Example response:

```json
{
  "batch": {
    "payoutId": "1",
    "sender": "GABC...",
    "recipientCount": 3,
    "successCount": 2,
    "totalSourceAmount": "10000000",
    "ledger": "123456"
  },
  "recipients": [
    {
      "payoutId": "1",
      "sender": "GABC...",
      "recipient": "GDEF...",
      "sourceAsset": "CSOURCE...",
      "destAsset": "CDEST...",
      "amountDelivered": "3300000",
      "success": true,
      "ledger": "123456"
    }
  ]
}
```

### `GET /health`

Returns indexer sync status.

Example response:

```json
{
  "status": "ok",
  "lastProcessedLedger": "123456",
  "latestLedger": 123460,
  "lagLedgers": 4
}
```
