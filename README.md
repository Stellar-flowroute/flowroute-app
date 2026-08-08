# FlowRoute

FlowRoute is a batched, slippage protected FX payout tool on the Stellar network. A business funds one payout run, and the FlowRoute contract swaps the source asset into each recipient's chosen destination asset through Soroswap, enforcing a per recipient minimum received.

This repository holds the application layer: a typed SDK for the FlowRoute contract, a Next.js dashboard, and an event indexer with a read API.

## Structure

- `packages/sdk`: typed client for the FlowRoute contract.
- `apps/web`: Next.js dashboard for building and running payout batches.
- `indexer`: event ingestion worker and read API backing the settlement history view.

## Development

This is a pnpm workspace. Install with `pnpm install`, then run `pnpm -r typecheck` to verify the project builds.

Full setup and deployment instructions are a later phase.
