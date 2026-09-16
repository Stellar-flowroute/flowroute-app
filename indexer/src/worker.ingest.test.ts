import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { i128ToScVal } from "@stellar-flowroute/sdk";
import type { Pool } from "pg";
import type { IndexerConfig } from "./config.js";
import { ingestOnce } from "./worker.js";

const CONTRACT = "CBB3UVMGMFVWLF6ZVMQYRQDWOXZUWNW4SD6SERG3RMLFXMWLZNOZ767U";
const PAGE_SIZE = 200; // must match EVENT_PAGE_SIZE in worker.ts

const config: IndexerConfig = {
  databaseUrl: "postgres://unused",
  databaseSsl: false,
  contractId: CONTRACT,
  rpcUrl: "http://unused",
  startLedger: 900,
};

// Fast retries so failure cases stay quick; production uses the defaults.
const fastRetry = { maxFetchAttempts: 3, initialBackoffMs: 1 };

interface FakePoolState {
  cursor: bigint | null;
  cursorWrites: bigint[];
  payoutRows: Map<string, unknown[]>;
  batchRows: Map<string, unknown[]>;
  payoutWrites: number;
  batchWrites: number;
}

// Stands in for pg's Pool. Upserts key on the same conflict targets as schema.sql so the fake reproduces the real
// ON CONFLICT DO UPDATE behaviour, which is what makes repeated ingestion idempotent.
function createFakePool(initialCursor: bigint | null = null): { pool: Pool; state: FakePoolState } {
  const state: FakePoolState = {
    cursor: initialCursor,
    cursorWrites: [],
    payoutRows: new Map(),
    batchRows: new Map(),
    payoutWrites: 0,
    batchWrites: 0,
  };

  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      const statement = sql.replace(/\s+/g, " ").trim();

      if (statement.startsWith("select last_ledger from cursor")) {
        return { rows: state.cursor === null ? [] : [{ last_ledger: state.cursor.toString() }] };
      }
      if (statement.startsWith("insert into cursor")) {
        state.cursor = BigInt(params[0] as string);
        state.cursorWrites.push(state.cursor);
        return { rows: [] };
      }
      if (statement.startsWith("insert into payouts")) {
        state.payoutWrites += 1;
        state.payoutRows.set(`${params[0]}:${params[2]}`, params);
        return { rows: [] };
      }
      if (statement.startsWith("insert into batches")) {
        state.batchWrites += 1;
        state.batchRows.set(String(params[0]), params);
        return { rows: [] };
      }
      throw new Error(`fake pool received an unexpected statement: ${statement.slice(0, 60)}`);
    },
  } as unknown as Pool;

  return { pool, state };
}

interface Page {
  events: rpc.Api.EventResponse[];
  latestLedger: number;
  cursor: string;
}

interface FakeServer {
  server: rpc.Server;
  calls: rpc.Server.GetEventsRequest[];
  healthCalls: number;
}

interface Health {
  oldestLedger: number;
  latestLedger: number;
}

const PERMISSIVE_HEALTH: Health = { oldestLedger: 0, latestLedger: Number.MAX_SAFE_INTEGER };

// The last scripted step repeats forever, so a single `error` step models a call that never succeeds.
// `health` models the RPC's retained ledger range as reported by getHealth; it defaults to a window wide enough
// that it never constrains any existing test. Passing an array lets a test vary the reported range across
// successive ingestOnce() calls, modelling the retention window sliding forward between attempts.
function createFakeServer(
  steps: Array<Page | Error>,
  health: Health | Error | Array<Health | Error> = PERMISSIVE_HEALTH,
): FakeServer {
  const calls: rpc.Server.GetEventsRequest[] = [];
  const healthSteps = Array.isArray(health) ? health : [health];
  let index = 0;
  let healthIndex = 0;
  const state = { healthCalls: 0 };
  const server = {
    getEvents: async (options: rpc.Server.GetEventsRequest) => {
      calls.push(options);
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      if (step instanceof Error) {
        throw step;
      }
      return step;
    },
    getHealth: async () => {
      state.healthCalls += 1;
      const step = healthSteps[Math.min(healthIndex, healthSteps.length - 1)]!;
      healthIndex += 1;
      if (step instanceof Error) {
        throw step;
      }
      return {
        status: "healthy",
        latestLedger: step.latestLedger,
        latestLedgerCloseTime: "0",
        oldestLedger: step.oldestLedger,
        oldestLedgerCloseTime: "0",
        ledgerRetentionWindow: step.latestLedger - step.oldestLedger,
      };
    },
  } as unknown as rpc.Server;
  return {
    server,
    calls,
    get healthCalls() {
      return state.healthCalls;
    },
  };
}

function payoutEvent(ledger: number, payoutId: number): rpc.Api.EventResponse {
  return {
    id: `${ledger}-${payoutId}`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "a".repeat(64),
    topic: [
      xdr.ScVal.scvSymbol("payout"),
      xdr.ScVal.scvU64(new xdr.Uint64(payoutId)),
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
    ],
    value: xdr.ScVal.scvVec([
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      i128ToScVal(1_000_000n),
      xdr.ScVal.scvBool(true),
    ]),
  } as unknown as rpc.Api.EventResponse;
}

function batchEvent(ledger: number, payoutId: number, recipientCount: number): rpc.Api.EventResponse {
  return {
    id: `${ledger}-b${payoutId}`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "b".repeat(64),
    topic: [
      xdr.ScVal.scvSymbol("batch"),
      xdr.ScVal.scvU64(new xdr.Uint64(payoutId)),
      nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
    ],
    value: xdr.ScVal.scvVec([
      xdr.ScVal.scvU32(recipientCount),
      xdr.ScVal.scvU32(recipientCount),
      i128ToScVal(BigInt(recipientCount) * 1_000_000n),
    ]),
  } as unknown as rpc.Api.EventResponse;
}

// An event the parser rejects, used to model a processing failure partway through a page.
function malformedPayoutEvent(ledger: number): rpc.Api.EventResponse {
  return {
    id: `${ledger}-bad`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "c".repeat(64),
    topic: [xdr.ScVal.scvSymbol("payout")],
    value: xdr.ScVal.scvVec([xdr.ScVal.scvBool(true)]),
  } as unknown as rpc.Api.EventResponse;
}

function emptyPage(latestLedger: number, cursor = "empty"): Page {
  return { events: [], latestLedger, cursor };
}

test("successful contiguous indexing advances the cursor", async () => {
  const { pool, state } = createFakePool();
  const { server, calls } = createFakeServer([
    { events: [payoutEvent(950, 1), batchEvent(950, 1, 1)], latestLedger: 1000, cursor: "c1" },
  ]);

  await ingestOnce(config, pool, server);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.startLedger, 900);
  assert.equal(calls[0]!.cursor, undefined);
  assert.equal(state.cursor, 1000n);
  assert.deepEqual(state.cursorWrites, [1000n]);
  assert.equal(state.payoutRows.size, 1);
  assert.equal(state.batchRows.size, 1);
  assert.equal(state.batchRows.get("1")![2], 1); // recipient_count
  assert.equal(state.batchRows.get("1")![3], 1); // success_count
  assert.equal(state.batchRows.get("1")![5], "950"); // ledger
});

test("a fetch failure does not advance the cursor", async () => {
  const { pool, state } = createFakePool(1200n);
  const { server, calls } = createFakeServer([new Error("rpc unavailable")]);

  await assert.rejects(() => ingestOnce(config, pool, server, fastRetry), /rpc unavailable/);

  assert.equal(calls.length, 3); // bounded attempts, then the pass fails
  assert.equal(state.cursor, 1200n); // untouched
  assert.equal(state.cursorWrites.length, 0);
});

test("a processing failure does not advance the cursor past the failed range", async () => {
  const { pool, state } = createFakePool();
  const { server } = createFakeServer([
    { events: [payoutEvent(950, 1), malformedPayoutEvent(990)], latestLedger: 1000, cursor: "c1" },
  ]);

  await assert.rejects(() => ingestOnce(config, pool, server, fastRetry));

  assert.equal(state.cursor, null); // nothing was persisted, so the range is retried
  assert.equal(state.cursorWrites.length, 0);
  assert.equal(state.payoutRows.size, 1); // the event before the failure is still stored, and stays a single row
});

test("a pagination failure does not skip the remaining page", async () => {
  const { pool, state } = createFakePool();
  const fullPage: Page = {
    events: Array.from({ length: PAGE_SIZE }, (_, i) => payoutEvent(950, i + 1)),
    latestLedger: 1000,
    cursor: "page-1",
  };
  const { server, calls } = createFakeServer([fullPage, new Error("page 2 unavailable")]);

  await assert.rejects(() => ingestOnce(config, pool, server, fastRetry), /page 2 unavailable/);

  assert.equal(calls.length, 1 + 3); // page 1, then the bounded retries of page 2
  assert.equal(calls[1]!.cursor, "page-1"); // page 2 continues the same page chain
  assert.equal(state.cursor, null); // the remaining page is not skipped
  assert.equal(state.cursorWrites.length, 0);
  assert.equal(state.payoutRows.size, PAGE_SIZE); // page 1 was fully processed
});

test("retry after a failure resumes from the correct ledger", async () => {
  const { pool, state } = createFakePool();
  const failing = createFakeServer([new Error("transient rpc failure")]);
  await assert.rejects(() => ingestOnce(config, pool, failing.server, fastRetry));
  assert.equal(state.cursor, null);

  const healthy = createFakeServer([
    { events: [payoutEvent(950, 7)], latestLedger: 1000, cursor: "c1" },
  ]);
  await ingestOnce(config, pool, healthy.server);

  assert.equal(failing.calls[0]!.startLedger, 900);
  assert.equal(healthy.calls[0]!.startLedger, 900); // resumed from the persisted cursor, not from a jumped-ahead value
  assert.equal(state.cursor, 1000n);
  assert.equal(state.payoutRows.size, 1);
});

test("repeated processing remains idempotent", async () => {
  const { pool, state } = createFakePool();
  const page: Page = { events: [payoutEvent(950, 3), batchEvent(950, 3, 1)], latestLedger: 1000, cursor: "c1" };

  await ingestOnce(config, pool, createFakeServer([page]).server);
  const afterFirst = { payouts: state.payoutRows.size, batches: state.batchRows.size };

  // replay the same ledger range, as happens after a rewind or a restart
  state.cursor = null;
  await ingestOnce(config, pool, createFakeServer([page]).server);

  assert.deepEqual({ payouts: state.payoutRows.size, batches: state.batchRows.size }, afterFirst);
  assert.equal(state.payoutRows.size, 1);
  assert.equal(state.batchRows.size, 1);
  assert.equal(state.payoutWrites, 2); // written twice
  assert.equal(state.batchWrites, 2);
  assert.equal(state.cursor, 1000n);
});

test("an empty range advances the cursor without creating a gap", async () => {
  const { pool, state } = createFakePool();

  await ingestOnce(config, pool, createFakeServer([emptyPage(1200)]).server);
  assert.equal(state.cursor, 1200n); // a scanned range with no events is still covered

  const { server, calls } = createFakeServer([
    { events: [payoutEvent(1250, 9)], latestLedger: 1300, cursor: "c2" },
  ]);
  await ingestOnce(config, pool, server);

  assert.equal(calls[0]!.startLedger, 1200); // resumes exactly where the empty range ended
  assert.equal(state.payoutRows.size, 1); // the later event is not missed
  assert.equal(state.cursor, 1300n);
});

test("a node reporting a tip behind the cursor does not rewind it", async () => {
  const { pool, state } = createFakePool(1200n);
  const { server } = createFakeServer([emptyPage(1100)]);

  await assert.rejects(() => ingestOnce(config, pool, server), /behind the cursor at 1200/);

  assert.equal(state.cursor, 1200n);
  assert.equal(state.cursorWrites.length, 0);
});

test("a repeated paging cursor stops the pass instead of skipping ledgers", async () => {
  const { pool, state } = createFakePool();
  const events = Array.from({ length: PAGE_SIZE }, (_, i) => payoutEvent(950, i + 1));
  const { server, calls } = createFakeServer([
    { events, latestLedger: 1000, cursor: "stuck" },
    { events, latestLedger: 1000, cursor: "stuck" },
  ]);

  await assert.rejects(() => ingestOnce(config, pool, server, fastRetry), /repeated paging cursor stuck/);

  assert.equal(calls.length, 2); // did not spin
  assert.equal(state.cursor, null);
  assert.equal(state.cursorWrites.length, 0);
});

test("a restart from the persisted cursor does not miss events", async () => {
  const first = createFakePool();
  await ingestOnce(
    config,
    first.pool,
    createFakeServer([{ events: [payoutEvent(950, 11)], latestLedger: 1000, cursor: "c1" }]).server,
  );
  assert.equal(first.state.cursor, 1000n);

  // fresh process, fresh pool connection, cursor read back from the database
  const restarted = createFakePool(first.state.cursor);
  const { server, calls } = createFakeServer([
    { events: [payoutEvent(1005, 12), batchEvent(1005, 12, 1)], latestLedger: 1010, cursor: "c2" },
  ]);
  await ingestOnce(config, restarted.pool, server);

  assert.equal(calls[0]!.startLedger, 1000); // exactly the persisted cursor, so 1000..1005 is not skipped
  assert.equal(restarted.state.payoutRows.size, 1);
  assert.equal(restarted.state.batchRows.size, 1);
  assert.equal(restarted.state.batchRows.get("12")![5], "1005"); // the event right after the restart point landed
  assert.equal(restarted.state.cursor, 1010n);
});

// --- RPC-retention-aware bootstrap ---------------------------------------------------------------------------

test("A: a configured start ledger inside the RPC's retained range is used as-is", async () => {
  const { pool, state } = createFakePool(); // fresh database, cursor null
  const { server, calls } = createFakeServer(
    [{ events: [payoutEvent(950, 1)], latestLedger: 2000, cursor: "c1" }],
    { oldestLedger: 500, latestLedger: 2000 }, // config.startLedger (900) is inside 500..2000
  );

  await ingestOnce(config, pool, server);

  assert.equal(calls[0]!.startLedger, 900); // the configured hint, untouched
  assert.equal(state.cursor, 2000n);
});

test("B: a configured start ledger older than the retained floor bootstraps from the floor on a fresh database", async () => {
  const { pool, state } = createFakePool(); // fresh database, cursor null
  const { server, calls } = createFakeServer(
    [{ events: [payoutEvent(1550, 1)], latestLedger: 2000, cursor: "c1" }],
    { oldestLedger: 1500, latestLedger: 2000 }, // config.startLedger (900) is older than the floor
  );

  await ingestOnce(config, pool, server);

  assert.equal(calls[0]!.startLedger, 1500); // bootstrapped to the retained floor, not the stale 900 hint
  assert.equal(state.cursor, 2000n); // reflects only what was actually scanned, at/after the floor
});

test("C: an existing persisted cursor older than the retained floor fails loudly instead of jumping forward", async () => {
  const { pool, state } = createFakePool(1000n); // existing database with a persisted cursor
  const { server, calls } = createFakeServer(
    [{ events: [payoutEvent(1550, 1)], latestLedger: 2000, cursor: "c1" }],
    { oldestLedger: 1500, latestLedger: 2000 }, // the retention window has moved past the persisted cursor
  );

  await assert.rejects(() => ingestOnce(config, pool, server), /persisted cursor is at ledger 1000.*retained floor \(1500\)/);

  assert.equal(calls.length, 0); // never even attempted to fetch events over the gap
  assert.equal(state.cursor, 1000n); // untouched -- no silent skip ahead
  assert.equal(state.cursorWrites.length, 0);
});

test("D: the retention window moving between attempts still converges to a valid start", async () => {
  const { pool, state } = createFakePool(); // fresh database, cursor null
  const fetchFailure = new Error("rpc unavailable");
  const { server, calls } = createFakeServer(
    [fetchFailure, fetchFailure, fetchFailure, { events: [payoutEvent(1650, 1)], latestLedger: 2500, cursor: "c1" }],
    [
      { oldestLedger: 1500, latestLedger: 2000 }, // first attempt's reported floor
      { oldestLedger: 1600, latestLedger: 2500 }, // window has slid forward by the second attempt
    ],
  );

  await assert.rejects(() => ingestOnce(config, pool, server, fastRetry)); // first pass: bootstrapped to 1500, then fetch fails
  assert.equal(state.cursor, null);

  await ingestOnce(config, pool, server, fastRetry); // second pass: cursor still null, re-bootstraps against the new floor

  assert.equal(calls.length, 4); // 3 failed attempts from the first pass, then 1 successful attempt
  assert.equal(calls[0]!.startLedger, 1500); // first pass used the floor reported at that time
  assert.equal(calls[3]!.startLedger, 1600); // second pass used the floor reported this time, not the stale 1500
  assert.equal(state.cursor, 2500n);
});

test("E: a persistently failing RPC bootstrap check stays bounded, not a tight retry loop", async () => {
  const { pool, state } = createFakePool();
  const fake = createFakeServer([], new Error("rpc down"));

  await assert.rejects(() => ingestOnce(config, pool, fake.server, fastRetry), /rpc down/);

  assert.equal(fake.healthCalls, 3); // bounded by maxFetchAttempts, not an unbounded spin (read after the call completes)
  assert.equal(fake.calls.length, 0); // never got far enough to fetch events
  assert.equal(state.cursor, null);
});

test("F: pagination continues from the dynamically selected valid start", async () => {
  const { pool, state } = createFakePool();
  const fullPage: Page = {
    events: Array.from({ length: PAGE_SIZE }, (_, i) => payoutEvent(1550, i + 1)),
    latestLedger: 2000,
    cursor: "page-1",
  };
  const secondPage: Page = { events: [payoutEvent(1900, 999)], latestLedger: 2000, cursor: "page-2" };
  const { server, calls } = createFakeServer([fullPage, secondPage], { oldestLedger: 1500, latestLedger: 2000 });

  await ingestOnce(config, pool, server);

  assert.equal(calls[0]!.startLedger, 1500); // first page starts at the dynamically resolved floor
  assert.equal(calls[0]!.cursor, undefined);
  assert.equal(calls[1]!.cursor, "page-1"); // continuation pages page by RPC cursor, not by re-deriving a start ledger
  assert.equal(state.payoutRows.size, PAGE_SIZE + 1);
  assert.equal(state.cursor, 2000n);
});

test("G: a fresh database produces a correct initial cursor after a successful bootstrap ingestion", async () => {
  const { pool, state } = createFakePool();
  const { server } = createFakeServer(
    [{ events: [payoutEvent(1550, 1), batchEvent(1550, 1, 1)], latestLedger: 1800, cursor: "c1" }],
    { oldestLedger: 1500, latestLedger: 2000 },
  );

  assert.equal(state.cursor, null); // fresh database precondition
  await ingestOnce(config, pool, server);

  assert.equal(state.cursor, 1800n);
  assert.deepEqual(state.cursorWrites, [1800n]);
  assert.equal(state.payoutRows.size, 1);
  assert.equal(state.batchRows.size, 1);
});

test("H: bootstrapping past a stale start ledger never claims the skipped history was indexed", async () => {
  const { pool, state } = createFakePool();
  const { server } = createFakeServer(
    [{ events: [payoutEvent(1550, 1)], latestLedger: 2000, cursor: "c1" }],
    { oldestLedger: 1500, latestLedger: 2000 },
  );

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await ingestOnce(config, pool, server);
  } finally {
    console.warn = originalWarn;
  }

  // The gap between the configured hint (900) and the resolved floor (1500) is explicitly logged as unrecoverable,
  // not silently absorbed into a cursor that would claim it was scanned.
  assert.ok(warnings.some((args) => String(args[0]).includes("not recoverable")));
  assert.equal(state.cursor, 2000n); // the persisted cursor only covers what was actually scanned, from 1500 onward
  assert.equal(state.payoutRows.size, 1); // only the one event actually returned by the RPC, nothing fabricated
});
