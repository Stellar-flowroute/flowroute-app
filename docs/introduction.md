# Introduction

FlowRoute is a payout tool for businesses that need to send money to many people at once, where each recipient may want a different currency.

## The problem

A business that pays many recipients in one run, for example a marketplace paying out sellers or a platform paying out contributors, runs into three problems when the payout involves a currency conversion for each recipient.

First, there is no on-chain guarantee against slippage. If the price of an asset moves between the moment a payout is calculated and the moment it settles, a recipient can receive less than expected, and the sender has no enforceable floor unless the payment rail builds one in.

Second, there is no single auditable settlement record. A batch of manual transfers, or a batch built from several independent swaps, leaves the sender piecing together separate transaction histories to prove who was paid what.

Third, one bad transfer can hold up an entire batch. If a manual payout process depends on every leg succeeding before the batch is considered complete, a single failed or disputed transfer becomes a blocker for everyone else in the batch.

FlowRoute addresses all three by enforcing a per-recipient minimum received on-chain, emitting one settlement event per recipient plus one summary event per batch, and letting individual recipient failures resolve independently without blocking the rest of the batch.

## How it works

1. A business funds one payout run by specifying a source asset, a total amount, and a list of recipients, each with their own destination asset and minimum amount they must receive.
2. The business submits the payout run as a single transaction. The full source amount is pulled from the business into the FlowRoute contract.
3. The contract loops over the recipients. For each one, it swaps the recipient's allocated amount from the source asset into that recipient's destination asset through the Soroswap Router.
4. Each recipient's minimum received amount is enforced as a floor during their swap. A swap that would deliver less than the floor does not complete for that recipient.
5. A recipient whose swap does not complete has their allocated source amount refunded to the business at the end of the run. A recipient whose swap completes has their asset delivered immediately, with the floor already enforced.
6. Every recipient outcome is recorded as an on-chain event, along with one summary event for the batch, and the indexer picks up these events so the settlement history is queryable through a read API.
