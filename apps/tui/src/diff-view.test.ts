import { expect, test } from "bun:test";
import { RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import type { DiffMode } from "./diff";
import { mountReview } from "./view";
import { themes } from "./theme";

function review(unified?: string) {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  if (unified) {
    snapshot.files[0].diff = { kind: "text", unified };
    snapshot.sections = [
      {
        title: "Ungrouped changes",
        explanation: "Inspect all changes.",
        references: [{ kind: "file", fileId: "greeting" }],
      },
    ];
  }
  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

test("both themes paint full inline rows and full split panes, including unequal wrapping", async () => {
  const data = review(
    `diff --git a/src/greeting.ts b/src/greeting.ts\n--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1,2 +1,2 @@\n-${"x".repeat(85)}OLD_END\n+new\n same\n\\ No newline at end of file\n`,
  );
  for (const theme of Object.values(themes)) {
    for (const mode of ["inline", "side-by-side"] as DiffMode[]) {
      const ui = await createTestRenderer({ width: 120, height: 40 });
      try {
        mountReview(ui.renderer, data, theme, mode);
        await ui.mockInput.pressKeys(["n"]);
        await ui.renderOnce();
        const captured = ui.captureSpans();
        const lineText = (index: number) =>
          captured.lines[index].spans.map((span) => span.text).join("");
        const oldRow = captured.lines.findIndex((_, index) =>
          lineText(index).includes("-xxxxx"),
        );
        const newRow = captured.lines.findIndex((_, index) =>
          lineText(index).includes("+new"),
        );
        expect(oldRow).toBeGreaterThan(0);
        const cells = (index: number) =>
          captured.lines[index].spans.flatMap((span) =>
            Array(span.width).fill(span),
          );
        expect(
          cells(oldRow)[2].bg.equals(
            RGBA.fromHex(theme.diff.deletion.background),
          ),
        ).toBe(true);
        const added = captured.lines[newRow].spans.find((span) =>
          span.text.includes("+new"),
        );
        expect(
          added?.fg.equals(RGBA.fromHex(theme.diff.addition.foreground)),
        ).toBe(true);
        expect(
          added?.bg.equals(RGBA.fromHex(theme.diff.addition.background)),
        ).toBe(true);
        if (mode === "inline") {
          expect(oldRow).toBeLessThan(newRow);
          expect(
            cells(oldRow)[116].bg.equals(
              RGBA.fromHex(theme.diff.deletion.background),
            ),
          ).toBe(true);
          expect(
            cells(newRow)[116].bg.equals(
              RGBA.fromHex(theme.diff.addition.background),
            ),
          ).toBe(true);
        } else {
          expect(oldRow).toBe(newRow);
          expect(lineText(oldRow + 1)).toContain("OLD_END");
          expect(
            cells(oldRow + 1)[116].bg.equals(
              RGBA.fromHex(theme.diff.addition.background),
            ),
          ).toBe(true);
          expect(
            cells(oldRow + 1)[2].bg.equals(
              RGBA.fromHex(theme.diff.deletion.background),
            ),
          ).toBe(true);
        }
        for (const [text, fg] of [
          ["diff --git", theme.diff.file],
          ["@@ -1", theme.diff.hunk],
          ["same", theme.diff.context],
          ["No newline", theme.diff.marker],
        ]) {
          const span = captured.lines
            .flatMap((line) => line.spans)
            .find((span) => span.text.includes(text));
          expect(span).toBeDefined();
          expect(span?.fg.equals(RGBA.fromHex(fg))).toBe(true);
        }
      } finally {
        await ui.dispose();
      }
    }
  }
});

test("automatic layouts vary by selected file, resize at the threshold, and can be cycled live", async () => {
  const ui = await createTestRenderer({ width: 103, height: 45 });
  try {
    const applyTheme = mountReview(ui.renderer, review());
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(
      "src/greeting.ts (modified) [side-by-side]",
    );
    expect(ui.captureCharFrame()).toContain("docs/guide.md (renamed) [inline]");
    expect(ui.captureCharFrame()).not.toContain("-Old guide");
    const before = ui.captureCharFrame();
    applyTheme(themes["github-light"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toBe(before);
    ui.resize(102, 45);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(
      "src/greeting.ts (modified) [inline]",
    );
    ui.resize(103, 45);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(
      "src/greeting.ts (modified) [side-by-side]",
    );
    await ui.mockInput.pressKeys(["d"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("d: diff inline");
    expect(ui.captureCharFrame()).toContain(
      "src/greeting.ts (modified) [inline]",
    );
    await ui.mockInput.pressKeys(["d"]);
    ui.resize(40, 45);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Old (left) | New (right)");
    await ui.mockInput.pressKeys(["n", "p"]);
    ui.resize(120, 45);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(
      "docs/guide.md (renamed) [side-by-side]",
    );
    await ui.mockInput.pressKeys(["d"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("docs/guide.md (renamed) [inline]");
    await ui.mockInput.pressKeys(["n", "n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(
      "Binary file: textual diff is not available.",
    );
    expect(ui.captureCharFrame()).toContain(
      "Diff unavailable: Diff omitted by source",
    );
  } finally {
    await ui.dispose();
  }
});

test("mode and width changes anchor scrolled diffs while theme changes preserve the exact frame", async () => {
  const unified = `@@ -1,60 +1,60 @@\n${Array.from({ length: 60 }, (_, i) => `-old_${i + 1}\n+new_${i + 1}\n`).join("")}`;
  const ui = await createTestRenderer({ width: 120, height: 24 });
  try {
    const applyTheme = mountReview(
      ui.renderer,
      review(unified),
      themes["github-dark"],
      "inline",
    );
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    await ui.mockInput.pressKeys(Array(35).fill("j"));
    await ui.renderOnce();
    const body = ui.renderer.root.findDescendantById(
      "body",
    ) as ScrollBoxRenderable;
    const visible = () =>
      ui.captureCharFrame().split("\n").slice(2, -3).join("\n");
    const before = visible().match(/(?:old|new)_(\d+)/)?.[1];
    expect(before).toBeDefined();
    await ui.mockInput.pressKeys(["d"]);
    await ui.renderOnce();
    expect(visible()).toContain(`old_${before}`);
    expect(body.scrollTop).toBeGreaterThan(0);
    const frame = ui.captureCharFrame();
    const offset = body.scrollTop;
    applyTheme(themes["github-light"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toBe(frame);
    expect(body.scrollTop).toBe(offset);
    await ui.mockInput.pressKeys(["d"]); // side-by-side -> auto
    await ui.renderOnce();
    const anchor = visible().match(/old_(\d+)/)?.[1];
    ui.resize(65, 24);
    await ui.renderOnce();
    expect(visible()).toContain(`old_${anchor}`);
    expect(body.scrollTop).toBeGreaterThan(0);
    await ui.mockInput.pressKeys(Array(40).fill("\u001b[6~"));
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("+new_60");
  } finally {
    await ui.dispose();
  }
});

test("markers, metadata, and empty sections retain readable themed messages in both modes", async () => {
  const data = review();
  data.snapshot.files.push({
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
  data.snapshot.sections = [
    {
      title: "Other files",
      explanation: "Inspect limits.",
      references: data.snapshot.files
        .slice(2)
        .map((file) => ({ kind: "file", fileId: file.id })),
    },
    { title: "Empty", explanation: "No changes here.", references: [] },
  ];
  data.analysis = analyzeDiffs(data.snapshot);
  for (const theme of Object.values(themes)) {
    const ui = await createTestRenderer({ width: 120, height: 45 });
    try {
      mountReview(ui.renderer, data, theme);
      await ui.mockInput.pressKeys(["n"]);
      await ui.renderOnce();
      for (const mode of ["inline", "side-by-side"]) {
        await ui.mockInput.pressKeys(["d"]);
        await ui.renderOnce();
        expect(ui.captureCharFrame()).toContain(`d: diff ${mode}`);
        for (const text of [
          "Binary file:",
          "Diff unavailable:",
          "Metadata-only change:",
        ]) {
          const span = ui
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((span) => span.text.includes(text));
          expect(span?.fg.equals(RGBA.fromHex(theme.diff.marker))).toBe(true);
          expect(span?.bg.equals(RGBA.fromHex(theme.diff.background))).toBe(
            true,
          );
        }
        expect(ui.captureCharFrame()).toContain("old mode 100644");
        expect(ui.captureCharFrame()).toContain("new mode 100755");
      }
      await ui.mockInput.pressKeys(["n"]);
      await ui.renderOnce();
      expect(ui.captureCharFrame()).toContain("(No referenced changes)");
    } finally {
      await ui.dispose();
    }
  }
});
