import { describe, expect, test } from "bun:test";
import { analyzeDiffs, type DiffFile, parseDiff, parseSnapshot } from "./index";

const textFile = (unified: string): DiffFile => ({
  id: "sample",
  oldPath: "old.txt",
  newPath: "new.txt",
  status: "renamed",
  diff: { kind: "text", unified },
});

const fixture = await Bun.file(
  new URL("../fixtures/valid.json", import.meta.url),
).text();

describe("unified diff processing", () => {
  test("preserves headers, lines, numbering and newline markers exactly", () => {
    const input =
      "diff --git a/old.txt b/new.txt\r\nsimilarity index 80%\r\nrename from old.txt\r\nrename to new.txt\r\n--- a/old.txt\r\n+++ b/new.txt\r\n@@ -1,2 +1,2 @@ heading\r\n-old\r\n+new\r\n context\r\n@@ -5,0 +6 @@\r\n+last\r\n\\ No newline at end of file";
    const diff = parseDiff(textFile(input));

    expect(diff.kind).toBe("text");

    if (diff.kind !== "text") throw new Error("expected text");

    expect(
      [
        ...diff.header,
        ...diff.hunks.flatMap((hunk) => [
          hunk.header,
          ...hunk.lines.map((line) => line.raw),
        ]),
      ].join(""),
    ).toBe(input);
    expect(
      diff.hunks[0].lines.map(({ kind, oldLine, newLine }) => [
        kind,
        oldLine,
        newLine,
      ]),
    ).toEqual([
      ["deletion", 1, null],
      ["addition", null, 1],
      ["context", 2, 2],
    ]);
    expect(
      diff.hunks[1].lines.map(({ kind, oldLine, newLine }) => [
        kind,
        oldLine,
        newLine,
      ]),
    ).toEqual([
      ["addition", null, 6],
      ["no-newline", null, null],
    ]);
  });

  test("accepts pure additions, deletions and metadata-only renames", () => {
    expect(parseDiff(textFile("@@ -0,0 +1 @@\n+new\n"))).toMatchObject({
      hunks: [{ oldCount: 0, newCount: 1 }],
    });
    expect(parseDiff(textFile("@@ -1 +0,0 @@\n-old\n"))).toMatchObject({
      hunks: [{ oldCount: 1, newCount: 0 }],
    });
    expect(
      parseDiff(
        textFile(
          "diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\n",
        ),
      ),
    ).toMatchObject({ hunks: [] });
  });

  test("rejects malformed, incomplete, multi-file and unsupported diffs with file identity", () => {
    for (const input of [
      "@@ -1,2 +1 @@\n-old\n+new\n",
      "@@ -1 +1 @@\n-old\n+new\n+extra\n",
      "@@ -1 +1 @@\n-old\n+new\ndiff --git a/b b/b\n",
      "diff --git a/a b/a\nGIT binary patch\n",
      "--- a/a\n@@ -1 +1 @@\n-old\n+new\n",
      "@@@ -1 -1 +1 @@@\n",
    ])
      expect(() => parseDiff(textFile(input))).toThrow('File "sample"');
  });
});

describe("reference resolution and coverage", () => {
  test("resolves split and multi-file sections and reports each uncovered side", () => {
    const snapshot = parseSnapshot(fixture);
    const result = analyzeDiffs(snapshot);

    expect(result.invalidReferences).toEqual([]);
    expect(result.sections.map((section) => section.length)).toEqual([3, 2, 2]);
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].fileId).toBe("guide");
    expect(
      result.uncovered[0].lines.map((line) => [
        line.kind,
        line.oldLine,
        line.raw,
      ]),
    ).toEqual([["deletion", 1, "-Old guide\n"]]);

    snapshot.sections[0].references.push({ kind: "file", fileId: "guide" });

    expect(analyzeDiffs(snapshot).uncovered).toEqual([]);
  });

  test("reports invalid ranges, context-only ranges, and non-text line references", () => {
    const snapshot = parseSnapshot(fixture);
    snapshot.sections[0].references = [
      {
        kind: "lines",
        fileId: "greeting",
        side: "old",
        startLine: 2,
        endLine: 2,
      },
      {
        kind: "lines",
        fileId: "greeting",
        side: "new",
        startLine: 99,
        endLine: 100,
      },
      { kind: "lines", fileId: "image", side: "new", startLine: 1, endLine: 1 },
    ];

    const result = analyzeDiffs(snapshot);

    expect(result.invalidReferences.map((item) => item.referenceIndex)).toEqual(
      [0, 1, 2],
    );
    expect(result.invalidReferences[2].message).toContain(
      "requires a text diff",
    );
    expect(
      result.uncovered.find((file) => file.fileId === "greeting")?.lines,
    ).toHaveLength(2);
  });

  test("reports unreferenced binary, unavailable and metadata-only files", () => {
    const snapshot = parseSnapshot(fixture);

    snapshot.files.push(
      textFile(
        "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n",
      ),
    );
    snapshot.sections = [];

    expect(
      analyzeDiffs(snapshot).uncovered.map(({ fileId, kind }) => [
        fileId,
        kind,
      ]),
    ).toEqual([
      ["greeting", "text"],
      ["guide", "text"],
      ["image", "binary"],
      ["large", "unavailable"],
      ["sample", "text"],
    ]);
  });

  test("retains a selected line's no-newline marker", () => {
    const snapshot = parseSnapshot(fixture);
    snapshot.files = [
      textFile("@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n"),
    ];
    snapshot.sections = [
      {
        title: "Change",
        explanation: "",
        references: [
          {
            kind: "lines",
            fileId: "sample",
            side: "new",
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    ];

    expect(
      analyzeDiffs(snapshot).sections[0][0].hunks[0].lines.map(
        (line) => line.kind,
      ),
    ).toEqual(["addition", "no-newline"]);
  });
});
