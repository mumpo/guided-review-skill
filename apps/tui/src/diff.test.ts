import { expect, test } from "bun:test";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import fixture from "../../../packages/core/fixtures/valid.json";
import { renderSectionDiff } from "./diff";

const snapshot = () => structuredClone(fixture) as ReviewSnapshot;

test("multi-file and split-file excerpts retain real line numbers and original order", () => {
  const review = snapshot();

  // Reversed and repeated references must not reorder or duplicate diff lines.
  review.sections[0].references.reverse();
  review.sections[0].references.push(...review.sections[0].references);

  const analysis = analyzeDiffs(review);
  const greeting = renderSectionDiff(analysis.sections[0]);

  expect(greeting).toContain("File: guide.md -> docs/guide.md (renamed)");
  expect(greeting).toContain("File: src/greeting.ts (modified)");
  expect(greeting).toContain("  1 |     | -hello\n    |   1 | +hello world");
  expect(greeting.match(/\+hello world/g)).toHaveLength(1);
  expect(greeting).toContain("... unreferenced lines omitted ...");
  expect(greeting).toContain("... unreferenced hunks omitted ...");
  expect(greeting).not.toContain("-Old guide");
  expect(greeting).not.toContain("-goodbye");

  const farewell = renderSectionDiff(analysis.sections[1]);

  expect(farewell).toContain(" 10 |     | -goodbye\n    |  10 | +see you");
  expect(farewell).not.toContain("+hello world");
});

test("whole files preserve headers, context, no-newline markers, and non-text limits", () => {
  const review = snapshot();
  review.files[0].diff = {
    kind: "text",
    unified:
      "diff --git a/src/greeting.ts b/src/greeting.ts\n--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n\\ No newline at end of file\n",
  };
  review.files.push({
    id: "mode",
    oldPath: "script.sh",
    newPath: "script.sh",
    status: "modified",
    diff: {
      kind: "text",
      unified:
        "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n",
    },
  });
  review.sections = [
    {
      title: "Ungrouped changes",
      explanation: "Inspect remaining changes.",
      references: review.files.map((file) => ({
        kind: "file",
        fileId: file.id,
      })),
    },
  ];

  const output = renderSectionDiff(analyzeDiffs(review).sections[0]);

  expect(output).toContain("--- a/src/greeting.ts\n+++ b/src/greeting.ts");
  expect(output).toContain("  2 |   2 |  same");
  expect(output).toContain("    |     | \\ No newline at end of file");
  expect(output).not.toContain("omitted ...");
  expect(output).toContain("File: image.png (added)\nBinary file:");
  expect(output).toContain("Diff unavailable: Diff omitted by source");
  expect(output).toContain("old mode 100644\nnew mode 100755");
  expect(output).toContain("Metadata-only change: no textual hunks.");
  expect(renderSectionDiff([])).toBe("(No referenced changes)");
});

test("partial hunks mark internal gaps and keep no-newline markers with selected lines", () => {
  const review = snapshot();
  review.files[0].diff = {
    kind: "text",
    unified:
      "@@ -1,3 +1 @@\n-first\n-middle\n-last\n+new\n\\ No newline at end of file\n",
  };
  review.sections[0].references = [
    {
      kind: "lines",
      fileId: "greeting",
      side: "old",
      startLine: 1,
      endLine: 1,
    },
    {
      kind: "lines",
      fileId: "greeting",
      side: "old",
      startLine: 3,
      endLine: 3,
    },
    {
      kind: "lines",
      fileId: "greeting",
      side: "new",
      startLine: 1,
      endLine: 1,
    },
  ];

  const output = renderSectionDiff(analyzeDiffs(review).sections[0]);

  expect(output).toContain(
    "-first\n... unreferenced lines omitted ...\n  3 |     | -last",
  );
  expect(output).toContain("+new\n    |     | \\ No newline at end of file");
  expect(output).not.toContain("-middle");
});

test("automatic mode classifies selected changes per file and obeys the width boundary", async () => {
  const { sectionDiffRows, effectiveDiffMode } = await import("./diff");
  const files = sectionDiffRows(analyzeDiffs(snapshot()).sections[0]);

  expect(effectiveDiffMode(files[0], "auto", 100)).toBe("side-by-side");
  expect(effectiveDiffMode(files[0], "auto", 99)).toBe("inline");
  expect(effectiveDiffMode(files[1], "auto", 150)).toBe("inline");
  expect(effectiveDiffMode(files[1], "side-by-side", 20)).toBe("side-by-side");
  expect(effectiveDiffMode(files[0], "inline", 150)).toBe("inline");

  const review = snapshot();
  review.sections[0].references = [
    {
      kind: "lines",
      fileId: "greeting",
      side: "old",
      startLine: 1,
      endLine: 1,
    },
  ];

  expect(
    effectiveDiffMode(
      sectionDiffRows(analyzeDiffs(review).sections[0])[0],
      "auto",
      150,
    ),
  ).toBe("inline");
});

test("side-by-side pairing preserves unequal blocks, context, no-newline markers, and source identity", async () => {
  const { sectionDiffRows, layoutFileRows } = await import("./diff");
  const review = snapshot();
  review.files[0].diff = {
    kind: "text",
    unified:
      "@@ -1,4 +1,3 @@\n-old one\n-old two\n+new one\n same\n-last old\n+last new\n\\ No newline at end of file\n",
  };
  review.sections[0].references = [{ kind: "file", fileId: "greeting" }];

  const file = sectionDiffRows(analyzeDiffs(review).sections[0])[0];
  const rows = layoutFileRows(file, "side-by-side");
  const pairs = rows.filter((row) => !row.full);

  expect(pairs.map((row) => [row.left?.text, row.right?.text])).toEqual([
    ["-old one", "+new one"],
    ["-old two", undefined],
    [" same", " same"],
    ["-last old", "+last new"],
  ]);
  expect(pairs[2].left?.prefix).toBe("  3 | ");
  expect(pairs[2].right?.prefix).toBe("  2 | ");
  expect(pairs[3].right?.marker).toBe("\\ No newline at end of file");
  expect(pairs[3].left?.marker).toBeUndefined();
  expect(rows.flatMap((row) => row.sources).sort((a, b) => a - b)).toEqual(
    file.rows.map((_, index) => index),
  );
  expect(
    layoutFileRows(file, "inline")
      .map((row) => row.full?.text)
      .join("\n"),
  ).toBe(renderSectionDiff(analyzeDiffs(review).sections[0]));
});

test("omitted ranges and hunks prevent pairing and never reveal unselected lines", async () => {
  const { sectionDiffRows, layoutFileRows } = await import("./diff");
  const review = snapshot();
  review.files[0].diff = {
    kind: "text",
    unified:
      "@@ -1,2 +1,2 @@\n-selected old\n-hidden old\n+hidden new\n+selected new\n@@ -10 +10 @@\n-later old\n+later new\n",
  };
  review.sections[0].references = [
    {
      kind: "lines",
      fileId: "greeting",
      side: "old",
      startLine: 1,
      endLine: 1,
    },
    {
      kind: "lines",
      fileId: "greeting",
      side: "new",
      startLine: 2,
      endLine: 2,
    },
    {
      kind: "lines",
      fileId: "greeting",
      side: "new",
      startLine: 10,
      endLine: 10,
    },
  ];

  const file = sectionDiffRows(analyzeDiffs(review).sections[0])[0];
  const rows = layoutFileRows(file, "side-by-side");

  expect(rows.filter((row) => row.left && row.right)).toHaveLength(0);
  expect(JSON.stringify(rows)).not.toContain("hidden");
  expect(rows.filter((row) => row.full?.role === "hunk")).toHaveLength(2);
  expect(
    rows.some((row) => row.full?.text.includes("unreferenced lines omitted")),
  ).toBe(true);
});
