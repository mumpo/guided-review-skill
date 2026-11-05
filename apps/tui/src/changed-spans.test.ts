import { expect, test } from "bun:test";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { sectionDiffRows, pairedFileRows } from "./diff";
import {
  compareLineSpans,
  changedFileSpans,
  emphasizeSpans,
} from "./changed-spans";

const range = (start: number, end: number) => ({ start, end });

test("precise ranges preserve insertions, deletions, replacements, and whitespace", () => {
  for (const [oldText, newText, old, next] of [
    ["hello", "hello world", [], [range(5, 11)]],
    ["hello world", "hello", [range(5, 11)], []],
    [
      "abc def ghi",
      "axc def gzi",
      [range(1, 2), range(9, 10)],
      [range(1, 2), range(9, 10)],
    ],
    ["a b", "a  b", [], [range(2, 3)]],
    ["a\tb", "a b", [range(1, 2)], [range(1, 2)]],
    ["a  ", "a ", [range(2, 3)], []],
    ["", "", [], []],
    ["same", "same", [], []],
    ["", "added", [], [range(0, 5)]],
    ["deleted", "", [range(0, 7)], []],
    ["aba", "bab", [range(0, 1)], [range(2, 3)]],
  ] as const) {
    expect(compareLineSpans(oldText, newText)).toEqual({
      old: [...old],
      new: [...next],
    });
  }
});

test("Unicode graphemes stay intact and offsets refer to unchanged UTF-16 source", () => {
  expect(compareLineSpans("a👩‍💻e\u0301z", "a👨‍💻éz")).toEqual({
    old: [range(1, 8)],
    new: [range(1, 7)],
  });
  expect(compareLineSpans("🙂same", "🙂sXame")).toEqual({
    old: [],
    new: [range(3, 4)],
  });
  expect(compareLineSpans("🇪🇸", "🇫🇷")).toEqual({
    old: [range(0, 4)],
    new: [range(0, 4)],
  });
});

test("expensive comparisons use a bounded differing region after prefix/suffix trimming", () => {
  const old = `prefix ${"a".repeat(501)}X suffix`;
  const next = `prefix ${"b".repeat(501)}Y suffix`;
  expect(compareLineSpans(old, next)).toEqual({
    old: [range(7, 509)],
    new: [range(7, 509)],
  });
  const huge = "x".repeat(100_000);
  expect(compareLineSpans(huge, `${huge}y`)).toEqual({
    old: [],
    new: [range(100_000, 100_001)],
  });
});

test("syntax and change intersections preserve exact source, colors, and whitespace", () => {
  const spans = [
    { text: "const ", color: "#123456" },
    { text: '"old"', color: "#abcdef" },
    { text: "  " },
  ];
  const result = emphasizeSpans(spans, [range(4, 8), range(11, 12)]);
  expect(result.map((s) => s.text).join("")).toBe('const "old"  ');
  expect(result.filter((s) => s.changed).map((s) => s.text)).toEqual([
    "t ",
    '"o',
    " ",
  ]);
  expect(result.find((s) => s.text === '"o')?.color).toBe("#abcdef");
});

function file(
  unified: string,
  references?: ReviewSnapshot["sections"][number]["references"],
) {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  snapshot.files[0].diff = { kind: "text", unified };
  snapshot.sections[0].references = references ?? [
    { kind: "file", fileId: "greeting" },
  ];
  return sectionDiffRows(analyzeDiffs(snapshot).sections[0])[0];
}

test("span comparison shares positional pairing, handles unequal blocks and attached markers", () => {
  const selected = file(
    "@@ -1,3 +1,2 @@\n-old one\n-old two\n+new one\n same\n\\ No newline at end of file\n",
  );
  const changes = changedFileSpans(selected);
  const pairs = pairedFileRows(selected);
  const pair = pairs.find((row) => row.left?.role === "deletion" && row.right);
  expect(changes.size).toBe(2);
  if (!pair?.left?.line || !pair.right?.line)
    throw new Error("Missing paired lines");
  expect(changes.get(pair.left.line)).toEqual([range(0, 3)]);
  expect(changes.get(pair.right.line)).toEqual([range(0, 3)]);
  const unmatched = pairs.find((row) => row.left?.text === "-old two")?.left
    ?.line;
  if (!unmatched) throw new Error("Missing unmatched line");
  expect(changes.has(unmatched)).toBe(false);
  const marked = file(
    "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
  );
  expect(changedFileSpans(marked).size).toBe(2);
});

test("context, hunks, omissions and independently selected sections prevent comparisons", () => {
  for (const unified of [
    "@@ -1,2 +1,2 @@\n-old\n context\n+new\n",
    "@@ -1 +0,0 @@\n-old\n@@ -3,0 +3 @@\n+new\n",
  ])
    expect(changedFileSpans(file(unified)).size).toBe(0);
  const unified = "@@ -1,2 +1,2 @@\n-old\n-hidden\n+hidden\n+new\n";
  const references = [
    {
      kind: "lines" as const,
      fileId: "greeting",
      side: "old" as const,
      startLine: 1,
      endLine: 1,
    },
    {
      kind: "lines" as const,
      fileId: "greeting",
      side: "new" as const,
      startLine: 2,
      endLine: 2,
    },
  ];
  const selected = file(unified, references);
  expect(changedFileSpans(selected).size).toBe(0);
  expect(JSON.stringify(pairedFileRows(selected))).not.toContain("hidden");
  for (const reference of references)
    expect(changedFileSpans(file(unified, [reference])).size).toBe(0);
});
