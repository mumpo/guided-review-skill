import { describe, expect, test } from "bun:test";
import {
  parseSnapshot,
  SnapshotValidationError,
  validateSnapshot,
} from "./index";

const validText = await Bun.file(
  new URL("../fixtures/valid.json", import.meta.url),
).text();
const invalidText = await Bun.file(
  new URL("../fixtures/invalid.json", import.meta.url),
).text();
const fixture = () => JSON.parse(validText);

describe("snapshot contract", () => {
  test("valid fixture survives a JSON round trip", () => {
    const snapshot = parseSnapshot(validText);
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(validateSnapshot(snapshot)).toBe(snapshot);
    expect(snapshot.sections[0].references).toHaveLength(3);
    expect(snapshot.files.map((file) => file.diff.kind)).toEqual([
      "text",
      "text",
      "binary",
      "unavailable",
    ]);
  });

  test("rejects malformed JSON and unsupported versions", () => {
    expect(() => parseSnapshot("{")).toThrow("Invalid JSON");
    expect(() => parseSnapshot(invalidText)).toThrow(
      "$.version: unsupported version",
    );
    expect(() => validateSnapshot(null)).toThrow(SnapshotValidationError);
  });

  test("reports malformed fields and paths", () => {
    const value = fixture();
    value.pullRequest.number = 0;
    expect(() => validateSnapshot(value)).toThrow(
      "$.pullRequest.number: expected a positive safe integer",
    );
    value.pullRequest.number = 42;
    value.files[0].oldPath = null;
    expect(() => validateSnapshot(value)).toThrow(
      "$.files[0]: modified files require both paths",
    );
    value.files[0].oldPath = "src/greeting.ts";
    delete value.files[0].diff.unified;
    expect(() => validateSnapshot(value)).toThrow("$.files[0].diff.unified");
  });

  test("rejects duplicate and unknown file IDs", () => {
    const value = fixture();
    value.files[1].id = value.files[0].id;
    expect(() => validateSnapshot(value)).toThrow(
      "$.files[1].id: duplicate file ID",
    );
    value.files[1].id = "guide";
    value.sections[0].references[0].fileId = "missing";
    expect(() => validateSnapshot(value)).toThrow(
      "$.sections[0].references[0].fileId: unknown file ID",
    );
  });

  test("rejects invalid line ranges and missing reference fields", () => {
    const value = fixture();
    const ref = value.sections[0].references[0];
    ref.startLine = 2;
    expect(() => validateSnapshot(value)).toThrow(
      ".endLine: must be greater than or equal to startLine",
    );
    ref.startLine = 0;
    expect(() => validateSnapshot(value)).toThrow(
      ".startLine: expected a positive safe integer",
    );
    ref.startLine = 1;
    delete ref.side;
    expect(() => validateSnapshot(value)).toThrow(
      ".side: expected one of: old, new",
    );
  });
});
