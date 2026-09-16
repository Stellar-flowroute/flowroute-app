# Contract reference

This page documents the FlowRoute Router contract as implemented in `flowroute-contract/contracts/router/src`. FlowRoute is unaudited software. Use it on testnet, at your own risk on mainnet.

## Public functions

### `initialize`

```
pub fn initialize(env: Env, admin: Address, swap_router: Address)
```

- **Parameters**:
  - `admin`, the address that becomes the contract's admin.
  - `swap_router`, the Soroswap Router contract address that the contract calls for every swap in `execute_batch`.
- **Returns**: nothing.
- **Auth**: requires authorization from the supplied `admin` address. The caller must be able to authorize as `admin` (Soroban `require_auth`), so an unrelated caller cannot claim an uninitialized deployment by naming someone else as admin.
- **What it does**: sets the admin, stores the swap router that later `execute_batch` calls are made against, clears the paused flag, and resets the payout counter to zero.
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
  - `recipients`, a list of `Recipient` structs (see Types below), holding between 1 and `MAX_BATCH_RECIPIENTS` entries.
  - `total_source_amount`, the sum of every recipient's `amount_in`.
- **Limits**:
  - `MAX_BATCH_RECIPIENTS` is 6. A payout run accepts at most six recipients; a longer list is rejected with `TooManyRecipients` rather than partially executed. `packages/sdk` exports the same constant, and the web app enforces it in its recipient table and CSV import, so the limit is applied before a transaction is ever built.
  - `total_source_amount` must be positive, every recipient's `amount_in` must be positive, and the sum of all `amount_in` values must equal `total_source_amount` exactly.
  - Every recipient's `dest_min` must be positive. It is the absolute floor of the destination asset that recipient's swap has to deliver. The contract does not simply trust the venue to enforce this floor: it measures its own balance delta after the venue call and, if a non-conforming venue reports success while delivering less than `dest_min`, aborts and rolls back the entire batch with `VenueUnderDelivered` rather than forwarding a short delivery (see `VenueUnderDelivered` below).
- **Returns**: a `Vec<PayoutResult>`, one entry per recipient, in the same order as the input list.
- **Auth**: requires authorization from `sender`.
- **What it does**: pulls `total_source_amount` of `source_asset` from `sender`, then for each recipient attempts a swap through the Soroswap Router into that recipient's `dest_asset`, enforcing `dest_min` as the output floor. For each recipient, the contract measures its own destination-asset balance delta after the venue call rather than trusting a return value:
  - If the venue call itself fails (an unreachable/misconfigured venue, an unresolvable pair, or the venue reverting the swap), that recipient's `amount_in` never left the contract and is refunded to `sender` at the end of the run; that recipient is recorded with `success: false` and `amount_delivered: 0`. This is an isolated, per-recipient outcome — it does not abort the batch, and every other recipient in the same run is still processed.
  - If the venue call returns success but the measured amount received is below that recipient's `dest_min` (a non-conforming venue), the **entire invocation reverts** with `VenueUnderDelivered`. Soroban rolls back every transfer the batch has made so far, so no partial payout or venue output is left committed for any recipient in that run.
  - Otherwise, the received amount (which meets or exceeds `dest_min`) is forwarded to the recipient and recorded with `success: true`.

  One `payout` event is emitted per recipient and one `batch` event is emitted for the run.
- **Reverts**:
  - `NotInitialized` if the contract has no admin set.
  - `Paused` if the contract is currently paused.
  - `EmptyBatch` if `recipients` is empty.
  - `TooManyRecipients` if `recipients` holds more than `MAX_BATCH_RECIPIENTS` (6) entries.
  - `InvalidAmount` if `total_source_amount` is not positive, if any recipient's `amount_in` or `dest_min` is not positive, if the sum of `amount_in` values overflows or does not equal `total_source_amount`, or if the payout counter would overflow.
  - `VenueUnderDelivered` if any recipient's swap reports success while delivering less than that recipient's `dest_min` — this aborts and rolls back the whole batch, not just that recipient.

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

All monetary values are `i128` integer base units. There are no floats anywhere in the contract. Every `amount_in` and every `dest_min` must be positive: `amount_in` is the source amount allocated to that recipient, and `dest_min` is the floor of the destination asset their swap must deliver.

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
| `VenueUnderDelivered` | 9 |
| `TooManyRecipients` | 10 |

`NotInitialized`, `AlreadyInitialized`, `Paused`, `EmptyBatch`, `TooManyRecipients`, `InvalidAmount`, and `VenueUnderDelivered` are raised (via `panic_with_error!`) directly by the functions documented above, and each of these aborts and rolls back the whole transaction.

`SwapFailed` is different: it exists as an internal `Result::Err` value inside `aggregator.rs` (returned when a pair cannot be resolved or the venue call itself reverts), but `execute_batch` always catches it and converts it into an isolated, refunded outcome for that one recipient — `SwapFailed` is never itself panicked or surfaced as a transaction-level revert. It must not be confused with `VenueUnderDelivered`: `SwapFailed` covers the venue failing outright (ordinary venue failure, isolated per recipient), while `VenueUnderDelivered` covers the venue reporting success but delivering less than the recipient's `dest_min` floor (a non-conforming venue), which aborts the entire batch rather than being isolated to that recipient.

`NotAdmin` and `SlippageExceeded` are declared in the enum but are not currently raised anywhere in the contract's own logic: admin authorization failures are caught by the Soroban auth framework before any contract code runs, not by an explicit `NotAdmin` panic, and `SlippageExceeded` appears only in the contract's test code, not in `lib.rs` or `aggregator.rs`.

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

The current deployment, and what every active environment in this repo is configured against:

| Contract | Network | Address |
| --- | --- | --- |
| FlowRoute Router | testnet | `CBB3UVMGMFVWLF6ZVMQYRQDWOXZUWNW4SD6SERG3RMLFXMWLZNOZ767U` |
| Soroswap Router (called by FlowRoute) | testnet | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |

The FlowRoute Router address is the contract ID to set as `FLOWROUTE_CONTRACT_ID` (SDK and indexer) and `NEXT_PUBLIC_FLOWROUTE_CONTRACT_ID` (web app). The Soroswap Router address is passed to `initialize` as `swap_router`; it is not an environment variable.

### Historical deployments

Superseded interfaces are listed here for reference only. Do not configure an active environment against them.

| Contract | Network | Address | Interface |
| --- | --- | --- | --- |
| FlowRoute Router (prior interface, superseded) | testnet | `CBDWWJOW25KPUID432RZXFIPLHRYZY5KIXBT7FMC2L6LHFOITBMUX5LE` | `initialize(admin)` with no `swap_router` argument |

FlowRoute is unaudited software. These are testnet addresses only.
