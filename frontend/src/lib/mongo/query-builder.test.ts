import { describe, expect, it } from "vitest";
import {
  unwrapFindOneAndUpdateDoc,
  wasFindOneAndUpdateUpsert,
  buildSingleFilter,
  buildMongoFilter,
  MongoQueryBuilder,
} from "./query-builder";
import { BrowserQueryBuilder } from "./browser-builder";

describe("unwrapFindOneAndUpdateDoc", () => {
  it("reads Mongo driver 6 ModifyResult.value", () => {
    const doc = { id: "msg-1", content_text: "hello" };
    expect(
      unwrapFindOneAndUpdateDoc({
        value: doc,
        ok: 1,
        lastErrorObject: { updatedExisting: false, upserted: "oid" },
      }),
    ).toEqual(doc);
  });

  it("reads Mongo driver 7 document return (no .value wrapper)", () => {
    const doc = { id: "msg-1", content_text: "hello" };
    expect(unwrapFindOneAndUpdateDoc(doc)).toEqual(doc);
  });

  it("returns undefined for empty ModifyResult", () => {
    expect(
      unwrapFindOneAndUpdateDoc({ value: null, ok: 1, lastErrorObject: {} }),
    ).toBeUndefined();
  });
});

describe("wasFindOneAndUpdateUpsert", () => {
  it("is true when lastErrorObject.upserted is set", () => {
    expect(
      wasFindOneAndUpdateUpsert({
        value: { id: "1" },
        lastErrorObject: { upserted: "oid" },
      }),
    ).toBe(true);
  });

  it("is false for a plain document (driver 7)", () => {
    expect(wasFindOneAndUpdateUpsert({ id: "1" })).toBe(false);
  });
});

describe("buildSingleFilter with 'not' operator", () => {
  it("translates .not('message_id', 'is', null) to { message_id: { $ne: null } }", () => {
    const filter = buildSingleFilter({
      op: "not",
      column: "message_id",
      value: null,
      subOp: "is",
    });
    expect(filter).toEqual({ message_id: { $ne: null } });
  });

  it("translates .not('status', 'eq', 'closed') to { status: { $ne: 'closed' } }", () => {
    const filter = buildSingleFilter({
      op: "not",
      column: "status",
      value: "closed",
      subOp: "eq",
    });
    expect(filter).toEqual({ status: { $ne: "closed" } });
  });

  it("translates .not('role', 'in', ['guest', 'banned']) to { role: { $nin: ['guest', 'banned'] } }", () => {
    const filter = buildSingleFilter({
      op: "not",
      column: "role",
      value: ["guest", "banned"],
      subOp: "in",
    });
    expect(filter).toEqual({ role: { $nin: ["guest", "banned"] } });
  });

  it("converts postgres json arrow operator and not.is null", () => {
    const filter = buildSingleFilter({
      op: "not",
      column: "payload->>meta_message_id",
      value: null,
      subOp: "is",
    });
    expect(filter).toEqual({ "payload.meta_message_id": { $ne: null } });
  });
});

describe("MongoQueryBuilder & BrowserQueryBuilder .not() chaining", () => {
  it("supports chaining .not('message_id', 'is', null) in MongoQueryBuilder", () => {
    const builder = new MongoQueryBuilder("messages", async () => ({
      data: null,
      count: null,
      error: null,
    }));

    builder
      .select("id, message_id")
      .eq("conversation_id", "conv-123")
      .eq("sender_type", "customer")
      .not("message_id", "is", null);

    expect(typeof builder.not).toBe("function");
    expect(builder.state.filters.length).toBe(3);

    const mongoFilter = buildMongoFilter(builder.state.filters);
    expect(mongoFilter).toEqual({
      $and: [
        { conversation_id: "conv-123" },
        { sender_type: "customer" },
        { message_id: { $ne: null } },
      ],
    });
  });

  it("supports chaining .filter('message_id', 'not.is', null) in MongoQueryBuilder", () => {
    const builder = new MongoQueryBuilder("messages", async () => ({
      data: null,
      count: null,
      error: null,
    }));

    builder
      .select("id, message_id")
      .filter("message_id", "not.is", null);

    const mongoFilter = buildMongoFilter(builder.state.filters);
    expect(mongoFilter).toEqual({ message_id: { $ne: null } });
  });

  it("supports chaining .not() in BrowserQueryBuilder", () => {
    const builder = new BrowserQueryBuilder("messages", async () => ({
      data: null,
      count: null,
      error: null,
    }));

    builder
      .select("id, message_id")
      .eq("conversation_id", "conv-123")
      .not("message_id", "is", null);

    expect(typeof builder.not).toBe("function");
    expect(builder.state.filters).toEqual([
      { op: "eq", column: "conversation_id", value: "conv-123" },
      { op: "not", column: "message_id", value: null, subOp: "is" },
    ]);
  });
});

