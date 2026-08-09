# Protocol mechanics

This page describes the full lifecycle of one payout run, matching the actual `execute_batch` logic in the FlowRoute contract in `flowroute-contract`.

## Lifecycle of one payout run

1. The contract checks that it has been initialized and is not paused, then requires authorization from the sender.
2. The contract validates the batch: the recipient list must not be empty, the total source amount must be positive, and the sum of each recipient's individual allocation must equal the stated total.
3. The full `total_source_amount` is pulled from the sender into the contract in one transfer.
4. The contract assigns this run a `payout_id` by incrementing its stored payout counter.
5. The contract loops over the recipients in order. For each recipient, it calls the Soroswap Router's swap function with that recipient's `amount_in`, `dest_min`, and destination asset, with the contract itself as the swap recipient so it can measure the amount actually received.
6. If the swap completes and the amount received meets or exceeds `dest_min`, the contract forwards that amount to the recipient's address and records the recipient as successful.
7. If the swap does not complete, the recipient's `amount_in` is added to a running refund total, since that amount never left the contract.
8. After all recipients are processed, any accumulated refund total is transferred back to the sender in one transfer.
9. The contract emits one `payout` event per recipient and one `batch` summary event for the run, then returns a `PayoutResult` per recipient to the caller.

One recipient failing never aborts the batch. Every other recipient in the same run is still processed.

## State machine

Each recipient in a payout run ends in exactly one of two states once the transaction confirms:

- **Success**: the swap delivered at least `dest_min` of the destination asset, and that amount was transferred to the recipient.
- **Failure with refund**: the swap did not complete, so the recipient's allocated source amount is refunded to the sender at the end of the run.

There is no partial or pending state once the transaction confirms. The Soroswap Router enforces `dest_min` internally and reverts the swap rather than returning a partial fill, so a recipient's outcome is always one of these two states, never a lesser amount than requested.

## Economic model

Each recipient has a `dest_min`, expressed as an absolute amount of the destination asset, but the FlowRoute web app computes that floor from a slippage tolerance the sender sets in basis points (bps). One basis point is 0.01%.

This example was tested live on testnet: a slippage tolerance of 100 bps (1%) applied to a quoted amount out derived from a 10000000 unit source allocation yields a minimum received of 9900000 units, a 1% reduction from the quoted amount. The web app's `applySlippage` function computes this as `amountOut * (10000 - slippageBps) / 10000`.

If the actual swap would deliver less than this floor, it does not complete for that recipient, and that recipient's allocation is refunded instead.
