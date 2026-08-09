# Contract reference

This page documents the FlowRoute Router contract as implemented in `flowroute-contract/contracts/router/src`. FlowRoute is unaudited software. Use it on testnet, at your own risk on mainnet.

## Public functions

### `initialize`

```
pub fn initialize(env: Env, admin: Address)
```

- **Parameters**: `admin`, the address that becomes the contract's admin.
- **Returns**: nothing.
- **Auth**: none required. The first caller to invoke this function sets the admin; there is no check that the caller and `admin` match.
- **What it does**: sets the admin, clears the paused flag, and resets the payout counter to zero.
- **Reverts**: with `AlreadyInitialized` if the contract already has an admin set.

### `execute_batch`

```
pub fn execute_batch(
    env: Env,
    sender: Address,
    source_asset: Address,
    recipients: Vec<Recipient>,
    total_source_amount: i128,
) -> Vec<PayoutResult>
```

- **Parameters**:
  - `sender`, the address funding the run and receiving any refunds.
  - `source_asset`, the token contract address of the asset being paid out.
  - `recipients`, a list of `Recipient` structs (see Types below).
  - `total_source_amount`, the sum of every recipient's `amount_in`.
- **Returns**: a `Vec<PayoutResult>`, one entry per recipient, in the same order as the input list.
- **Auth**: requires authorization from `sender`.
- **What it does**: pulls `total_source_amount` of `source_asset` from `sender`, then for each recipient attempts a swap through the Soroswap Router into that recipient's `dest_asset`, enforcing `dest_min` as the floor. Recipients whose swap completes receive their asset immediately. Recipients whose swap does not complete have their `amount_in` refunded to `sender` at the end of the run. One `payout` event is emitted per recipient and one `batch` event is emitted for the run.
- **Reverts**:
  - `NotInitialized` if the contract has no admin set.
  - `Paused` if the contract is currently paused.
  - `EmptyBatch` if `recipients` is empty.
  - `InvalidAmount` if `total_source_amount` is not positive, if any recipient's `amount_in` is not positive, if the sum of `amount_in` values overflows, if that sum does not equal `total_source_amount`, or if the payout counter would overflow.

### `set_paused`

```
pub fn set_paused(env: Env, paused: bool)
```

- **Parameters**: `paused`, the new paused state.
- **Returns**: nothing.
- **Auth**: requires authorization from the stored admin address.
- **What it does**: sets the contract's paused flag. While paused, `execute_batch` reverts for every caller.
- **Reverts**: with `NotInitialized` if the contract has no admin set.

### `get_payout_count`

```
pub fn get_payout_count(env: Env) -> u64
```

- **Parameters**: none.
- **Returns**: the number of payout runs executed so far, or 0 if the contract has not recorded any.
- **Auth**: none, this is a read-only call.
- **What it does**: returns the stored payout counter.
- **Reverts**: never.

## Types

```
pub struct Recipient {
    pub address: Address,
    pub dest_asset: Address,
    pub dest_min: i128,
    pub amount_in: i128,
}

pub struct PayoutResult {
    pub recipient: Address,
    pub success: bool,
    pub amount_delivered: i128,
}
```

All monetary values are `i128` integer base units. There are no floats anywhere in the contract.

## Errors

The full `Error` enum from `error.rs`:

| Variant | Code |
| --- | --- |
| `NotInitialized` | 1 |
| `AlreadyInitialized` | 2 |
| `NotAdmin` | 3 |
| `Paused` | 4 |
| `SlippageExceeded` | 5 |
| `EmptyBatch` | 6 |
| `InvalidAmount` | 7 |
| `SwapFailed` | 8 |

`NotInitialized`, `AlreadyInitialized`, `Paused`, `EmptyBatch`, and `InvalidAmount` are raised directly by the functions documented above. `SwapFailed` is raised internally when the call to the Soroswap Router does not succeed; this is what actually happens when a recipient's swap cannot meet its `dest_min` floor, since the router enforces that floor itself and reverts rather than returning a partial fill. `NotAdmin` and `SlippageExceeded` are declared in the enum but are not currently raised anywhere in the contract's own logic: admin authorization failures are caught by the Soroban auth framework before any contract code runs, not by an explicit `NotAdmin` panic, and `SlippageExceeded` appears only in the contract's test code, not in `lib.rs` or `aggregator.rs`.

## Events

Both events are defined in `events.rs` and are the auditable settlement record the indexer consumes.

### `payout`

One event per recipient per payout run.

- **Topics**: `("payout", payout_id: u64, sender: Address)`
- **Data**: `(recipient: Address, source_asset: Address, dest_asset: Address, amount_delivered: i128, success: bool)`

### `batch`

One summary event per payout run.

- **Topics**: `("batch", payout_id: u64, sender: Address)`
- **Data**: `(recipient_count: u32, success_count: u32, total_source_amount: i128)`

## Deployed addresses

| Contract | Network | Address |
| --- | --- | --- |
| FlowRoute Router | testnet | `CBDWWJOW25KPUID432RZXFIPLHRYZY5KIXBT7FMC2L6LHFOITBMUX5LE` |
| Soroswap Router (called by FlowRoute) | testnet | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |

FlowRoute is unaudited software. These are testnet addresses only.
