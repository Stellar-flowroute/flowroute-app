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

3. Fill in the deployed testnet contract ID (see [Contract reference](contract-reference.md)) as `FLOWROUTE_CONTRACT_ID` in `packages/sdk/.env.local` and `indexer/.env.local`, and as `NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID` in `apps/web/.env.local`. Set `DATABASE_URL` in `indexer/.env.local` to your local Postgres connection string, and `SOROSWAP_API_KEY` in `apps/web/.env.local` if you want the payout page's quote feature to work.

4. Start Postgres locally, for example with Docker.

5. Run the indexer worker, the indexer API, and the web app, each in its own terminal, in whichever order suits your workflow. The worker follows FlowRoute contract events into Postgres, the API serves that data, and the web app reads from the API for settlement history.

### Environment variables

`packages/sdk/.env.example` and `indexer/.env.example` share:

```
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
FLOWROUTE_CONTRACT_ID=
```

`indexer/.env.example` additionally has:

```
DATABASE_URL=postgres://user:password@localhost:5432/flowroute
DATABASE_SSL=0
INDEXER_START_LEDGER=0
```

`apps/web/.env.example`:

```
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID=
NEXT_PUBLIC_INDEXER_API_URL=http://localhost:3001
SOROSWAP_API_KEY=
```

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

Also exported: `loadConfig`, `requireContractId`, the `FlowRouteConfig` and `StellarNetwork` types, the `Recipient` and `PayoutResult` types, and the low-level XDR conversion helpers (`i128ToScVal`, `scValToI128`, `recipientToScVal`, `recipientsToScVal`, `scValToPayoutResult`, `scValToPayoutResults`).

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
