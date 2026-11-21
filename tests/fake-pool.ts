// A pg Pool and its clients, faked for lib/db.ts pgPoolDb and lib/db-watch.ts: each query checks out a client, runs on
// it and releases it, as pool.query does.
import type { Pool } from "pg";
import { vi } from "vitest";

/** A promise to settle by hand. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A client whose queries answer with `answer`; `fail` fires its "error" event, as a connection that dies does. */
export function fakeClient(answer: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const listeners = new Set<(err: Error) => void>();
  const client = {
    query: vi.fn(answer),
    on: vi.fn((event: string, fn: (err: Error) => void) => {
      if (event === "error") listeners.add(fn);
      return client;
    }),
    removeListener: vi.fn((event: string, fn: (err: Error) => void) => {
      if (event === "error") listeners.delete(fn);
      return client;
    }),
    release: vi.fn(),
    fail(err: Error) {
      for (const fn of [...listeners]) fn(err);
    },
    /** How many "error" listeners it has: one while checked out, none once released. */
    get listening() {
      return listeners.size;
    },
  };
  return client;
}

export type FakeClient = ReturnType<typeof fakeClient>;

/** A full pool: each connect waits until the test hands it a client (or an error), in the order they were asked. */
export function fakePool() {
  const asks: { resolve: (client: FakeClient) => void; reject: (err: unknown) => void }[] = [];
  const raw = {
    totalCount: 10,
    idleCount: 0,
    waitingCount: 0,
    connect: vi.fn(() => new Promise<FakeClient>((resolve, reject) => asks.push({ resolve, reject }))),
  };
  return { pool: raw as unknown as Pool, asks, raw };
}

/** A pool that hands out these clients at once, one a connect. */
export function poolOf(...clients: FakeClient[]) {
  const queue = [...clients];
  const connect = vi.fn(async () => {
    const client = queue.shift();
    if (!client) throw new Error("no more clients");
    return client;
  });
  return { pool: { connect, totalCount: 1, idleCount: 0, waitingCount: 0 } as unknown as Pool, connect };
}
