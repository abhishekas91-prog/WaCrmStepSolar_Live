import { describe, expect, it } from "vitest";
import {
  unwrapFindOneAndUpdateDoc,
  wasFindOneAndUpdateUpsert,
} from "./query-builder";

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
