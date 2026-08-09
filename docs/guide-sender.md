# Guide: for the sending business

This page is for the business funding a payout run through the FlowRoute web app.

## Connecting a wallet

FlowRoute uses Freighter, a browser extension wallet for Stellar. You connect it when you submit your first payout, not before. If Freighter is not installed or not connected, the app prompts you to connect it at that point.

## Entering recipients

You can add recipients to a payout run in two ways:

- **Manually**, one row at a time, entering each recipient's Stellar address, destination asset (as a token contract address), and the amount of the source asset allocated to them.
- **By CSV upload**, a file with one recipient per line in the form `address,dest_asset,amount_in`. An optional header row starting with `address,` is ignored if present.

Every recipient needs an address, a destination asset, and an amount before you can fetch quotes or submit the run.

## Slippage tolerance

The slippage tolerance field, set in basis points, controls how far the actual amount received is allowed to fall short of the quoted amount before that recipient's swap is treated as unable to proceed. When you fetch quotes, FlowRoute takes the quoted amount out for each recipient and reduces it by your slippage tolerance to compute that recipient's minimum received. This minimum is enforced on-chain during the payout run, not just checked client-side.

A lower slippage tolerance protects recipients from receiving less than expected, but makes an individual swap more likely to fail if the price moves before your transaction confirms. A higher tolerance makes swaps more likely to succeed, at the cost of a lower guaranteed floor.

## If a recipient's swap fails

FlowRoute does not abort the whole run if one recipient's swap cannot meet its minimum received. That recipient is marked as failed, their allocated source amount is refunded to you at the end of the run, and every other recipient in the same run is still processed normally. The results table shown after submission tells you, per recipient, whether the swap succeeded and how much was delivered.

## Viewing settlement history

The Settlement history page lets you look up past payout runs by your sending address. Each run shows the total number of recipients, how many succeeded, the total source amount, and the ledger it settled in. Selecting a run expands it to show the outcome for each individual recipient.
