# Guide: for the recipient

This page is for someone receiving a payout through FlowRoute.

## What you need

- A Stellar address to receive the payout.
- If your destination asset is not XLM, a trustline to that asset already established on your account. FlowRoute does not create trustlines for you: the sending business enters your destination asset when they set up the payout, but you are responsible for having the trustline in place before the payout runs. If you do not have the trustline set up and the transfer to you cannot complete, that portion of the batch is refunded to the sender rather than delivered to you, and you receive nothing from that run.

## What a minimum-received guarantee means for you

When a payout run includes you as a recipient, the sender sets a minimum amount of your destination asset that you must receive. This minimum is enforced by the FlowRoute contract itself, not just promised. If the swap that produces your payment cannot deliver at least that minimum, it does not go through, and your allocation is refunded to the sender instead of being delivered to you at a worse rate. You never receive less than the minimum the sender set, you either receive at least that amount or you receive nothing from that run.

## Verifying a payout you received

Every payout to you is recorded on-chain as a `payout` event, and the run it was part of is recorded as a `batch` event. You can look up settlement history for the sender's address on the FlowRoute web app's Settlement history page, or query the indexer's read API directly, to confirm the amount delivered to your address and whether that leg of the run succeeded.
