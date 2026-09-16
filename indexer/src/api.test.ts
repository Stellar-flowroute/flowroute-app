import assert from "node:assert/strict";
import test from "node:test";
import type { rpc } from "@stellar/stellar-sdk";
import type { Pool } from "pg";
import { createApi } from "./api.js";

function fakePool(cursor: bigint | null | Error): Pool {
  return {
    query: async () => {
      if (cursor instanceof Error) {
        throw cursor;
      }
      return { rows: cursor === null ? [] : [{ last_ledger: cursor.toString() }] };
    },
  } as unknown as Pool;
}

function fakeServer(latestLedger: number | Error): rpc.Server {
  return {
    getLatestLedger: async () => {
      if (latestLedger instanceof Error) {
        throw latestLedger;
      }
      return { id: "x", sequence: latestLedger, protocolVersion: 21 };
    },
  } as unknown as rpc.Server;
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

test("healthy indexer returns ok with ledger info", async () => {
  const app = createApi(fakePool(950n), fakeServer(1000));
  const res = await app.request("/health");

  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.status, "ok");
  assert.equal(body.lastProcessedLedger, "950");
  assert.equal(body.latestLedger, 1000);
  assert.equal(body.lagLedgers, 50);
});

test("an unreachable database reports an unhealthy status instead of throwing", async () => {
  const app = createApi(fakePool(new Error("connection refused")), fakeServer(1000));
  const res = await app.request("/health");

  assert.equal(res.status, 503);
  const body = await jsonBody(res);
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "database_unavailable");
});

test("an unreachable rpc node does not fail the health check", async () => {
  const app = createApi(fakePool(950n), fakeServer(new Error("rpc timeout")));
  const res = await app.request("/health");

  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.status, "ok");
  assert.equal(body.lastProcessedLedger, "950");
  assert.equal(body.latestLedger, null);
  assert.equal(body.lagLedgers, null);
});

test("no cursor yet does not fail the health check", async () => {
  const app = createApi(fakePool(null), fakeServer(1000));
  const res = await app.request("/health");

  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.status, "ok");
  assert.equal(body.lastProcessedLedger, null);
  assert.equal(body.lagLedgers, null);
});

test("/batches still requires a sender", async () => {
  const app = createApi(fakePool(950n), fakeServer(1000));
  const res = await app.request("/batches");
  assert.equal(res.status, 400);
});
