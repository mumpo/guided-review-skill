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
