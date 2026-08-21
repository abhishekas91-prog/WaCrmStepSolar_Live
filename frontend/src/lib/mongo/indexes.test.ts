import { describe, expect, it, vi } from "vitest";
import { ensureIndexes, indexSpecs } from "./indexes";
import type { MongoIndexSpec } from "./indexes";

const totalSpecs = Object.values(indexSpecs).reduce(
  (n, specs: MongoIndexSpec[]) => n + specs.length,
  0,
);

function fakeDb(opts: { rejectWith?: (spec: MongoIndexSpec) => unknown } = {}) {
  const createIndex = vi.fn(async (key: Record<string, number>, options: Record<string, unknown>) => {
    if (opts.rejectWith) {
      throw opts.rejectWith({ key, ...options } as unknown as MongoIndexSpec);
    }
  });
  const collection = vi.fn(() => ({ createIndex }));
  return { db: { collection } as any, createIndex, collection };
}

describe("ensureIndexes", () => {
  it("creates every index across all tables", async () => {
    const { db, createIndex, collection } = fakeDb();
    const res = await ensureIndexes(db);
    expect(res.created).toBe(totalSpecs);
    expect(res.skipped).toBe(0);
    expect(res.failed).toBe(0);
    expect(collection).toHaveBeenCalledTimes(totalSpecs);
    expect(createIndex).toHaveBeenCalledTimes(totalSpecs);
    const firstCall = createIndex.mock.calls[0];
    expect(firstCall[0]).toEqual({ id: 1 });
  });

  it("skips indexes that conflict with existing ones (code 85)", async () => {
    const { db } = fakeDb({
      rejectWith: () => Object.assign(new Error("IndexOptionsConflict"), { code: 85 }),
    });
    const res = await ensureIndexes(db);
    expect(res.skipped).toBe(totalSpecs);
    expect(res.created).toBe(0);
    expect(res.failed).toBe(0);
  });

  it("counts unrelated errors as failed but keeps going", async () => {
    const { db } = fakeDb({ rejectWith: () => new Error("boom") });
    const res = await ensureIndexes(db);
    expect(res.failed).toBe(totalSpecs);
    expect(res.created).toBe(0);
  });

  it("returns a per-collection index name for the TTL index", async () => {
    const { db, createIndex } = fakeDb();
    await ensureIndexes(db);
    const ttl = createIndex.mock.calls.find(
      ([, options]) => (options as { name?: string }).name === "realtime_changes_ts_ttl",
    );
    expect(ttl).toBeTruthy();
    expect((ttl![1] as { expireAfterSeconds?: number }).expireAfterSeconds).toBe(600);
  });
});
