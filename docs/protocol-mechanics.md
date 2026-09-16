# Protocol mechanics

This page describes the full lifecycle of one payout run, matching the actual `execute_batch` logic in the FlowRoute contract in `flowroute-contract`.

## Lifecycle of one payout run

1. The contract checks that it has been initialized and is not paused, then requires authorization from the sender.
2. The contract validates the batch: the recipient list must hold between 1 and `MAX_BATCH_RECIPIENTS` (6) entries, the total source amount must be positive, every recipient's `amount_in` and `dest_min` must be positive, and the sum of each recipient's individual allocation must equal the stated total. A batch that breaks any of these is rejected rather than partially executed. The web app applies the same checks client-side, against the shared `MAX_BATCH_RECIPIENTS` constant, before it simulates or signs anything.
3. The full `total_source_amount` is pulled from the sender into the contract in one transfer.
4. The contract assigns this run a `payout_id` by incrementing its stored payout counter.
5. The contract loops over the recipients in order. For each recipient, it calls the Soroswap Router's swap function with that recipient's `amount_in`, `dest_min`, and destination asset, with the contract itself as the swap recipient, and measures its own destination-asset balance delta after the call rather than trusting the venue's return value.
6. If the swap completes and the measured amount received meets or exceeds `dest_min`, the contract forwards that amount to the recipient's address and records the recipient as successful.
7. If the venue call itself does not complete (an unreachable/misconfigured venue, an unresolvable pair, or the venue reverting), the recipient's `amount_in` is added to a running refund total, since that amount never left the contract, and processing continues with the next recipient.
8. If the venue call reports success but the measured amount received is below that recipient's `dest_min` — a non-conforming venue — the contract aborts the **entire** invocation instead of continuing. Soroban rolls back every transfer the batch has made so far, so nothing from this run is left committed.
9. After all recipients are processed (assuming no abort in step 8), any accumulated refund total is transferred back to the sender in one transfer.
10. The contract emits one `payout` event per recipient and one `batch` summary event for the run, then returns a `PayoutResult` per recipient to the caller.

An ordinary venue failure for one recipient never aborts the batch; every other recipient in the same run is still processed. A non-conforming venue that under-delivers does abort the whole batch, atomically, because the contract does not trust the venue's success return value on its own.

## State machine

Each recipient in a payout run that *reaches a transaction confirmation* ends in exactly one of two states:

- **Success**: the swap delivered at least `dest_min` of the destination asset, and that amount was transferred to the recipient.
- **Failure with refund**: the venue call itself did not complete, so the recipient's allocated source amount is refunded to the sender at the end of the run.

There is no partial or pending state for an individual recipient's outcome within a confirmed transaction. This does not mean the venue is trusted to enforce `dest_min` on its own: if the venue reports success while delivering less than `dest_min`, the contract detects this itself (by measuring its own balance delta) and aborts the *entire* batch with `VenueUnderDelivered` rather than accepting a short delivery — so that scenario never reaches a "success" or "failure with refund" outcome for any recipient in the run; the whole transaction rolls back instead.

## Economic model

Each recipient has a `dest_min`, expressed as an absolute amount of the destination asset, and it must be positive: the contract rejects a batch that asks for a floor of zero. The FlowRoute web app computes that floor from a slippage tolerance the sender sets in basis points (bps). One basis point is 0.01%.

The floor is never allowed to round down to zero. If a slippage tolerance would reduce a positive quoted amount to zero base units, the app clamps the floor to one base unit instead, since the contract requires a positive `dest_min`.

This example was tested live on testnet: a slippage tolerance of 100 bps (1%) applied to a quoted amount out derived from a 10000000 unit source allocation yields a minimum received of 9900000 units, a 1% reduction from the quoted amount. The web app's `applySlippage` function computes this as `amountOut * (10000 - slippageBps) / 10000`.

If the venue itself cannot meet this floor and fails or reverts the swap, it does not complete for that recipient, and that recipient's allocation is refunded instead. If the venue instead reports success while actually delivering less than this floor, the contract catches that itself and aborts the entire batch with `VenueUnderDelivered` rather than accepting the short delivery for that recipient (see [State machine](#state-machine)).
