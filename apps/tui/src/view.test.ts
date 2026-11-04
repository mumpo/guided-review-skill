import { expect, test } from "bun:test";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
import { analyzeDiffs } from "../../../packages/core/src";
import { loadReview } from "./load";
import { mountReview } from "./view";

const fixture = new URL(
  "../../../packages/core/fixtures/valid.json",
  import.meta.url,
).pathname;

test("opens a local fixture and navigates ordered sections with real key events", async () => {
  const review = await loadReview(fixture);
  const ui = await createTestRenderer({ width: 100, height: 45 });
  try {
    mountReview(ui.renderer, review);
    await ui.renderOnce();
    const frame = ui.captureCharFrame();
    expect(frame).toContain("example/project #42 · Summary");
    expect(frame).toContain("Update the greeting");
    expect(frame).toContain(review.snapshot.pullRequest.baseCommit);
    expect(frame).toContain(review.snapshot.summary);
    expect(frame).toContain("1. Greeting");
    expect(frame).toContain("2. Farewell");
    expect(frame).toContain("3. Other files");
    expect(frame).toContain("outside the walkthrough");
    expect(frame).toContain("image.png: binary");
    expect(frame).toContain("large.txt: unavailable (Diff omitted by source)");

    await ui.mockInput.pressKeys(["p"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("#42 · Summary");
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 1/3: Greeting");
    expect(ui.captureCharFrame()).toContain(
      "Changes the greeting and its guide.",
    );
    expect(ui.captureCharFrame()).toContain("Diagram");
    expect(ui.captureCharFrame()).toContain("greeting -> guide");
    expect(ui.captureCharFrame()).toContain("File: src/greeting.ts (modified)");
    expect(ui.captureCharFrame()).toContain("  1 |     | -hello");
    expect(ui.captureCharFrame()).toContain("    |   1 | +hello world");
    expect(ui.captureCharFrame()).toContain("guide.md -> docs/guide.md");
    expect(ui.captureCharFrame()).not.toContain("-goodbye");
    await ui.mockInput.pressKeys([KeyCodes.ARROW_RIGHT]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 2/3: Farewell");
    expect(ui.captureCharFrame()).toContain(" 10 |     | -goodbye");
    expect(ui.captureCharFrame()).not.toContain("+hello world");
    ui.mockInput.pressTab();
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 3/3: Other files");
    expect(ui.captureCharFrame()).toContain(
      "Binary file: textual diff is not available.",
    );
    expect(ui.captureCharFrame()).toContain(
      "Diff unavailable: Diff omitted by source",
    );
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 3/3: Other files");
    ui.mockInput.pressTab({ shift: true });
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 2/3: Farewell");
    await ui.mockInput.pressKeys([KeyCodes.HOME]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("#42 · Summary");
    await ui.mockInput.pressKeys([KeyCodes.END]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 3/3: Other files");
    await ui.mockInput.pressKeys(["s"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("#42 · Summary");
    await ui.mockInput.pressKeys(["q"]);
    await ui.renderer.closed;
  } finally {
    await ui.dispose();
  }
});

test("ungrouped diffs scroll through wrapped code and resize without losing content", async () => {
  const review = await loadReview(fixture);
  const longCode = `+${"x".repeat(90)}WRAP_END`;
  review.snapshot.files[0].diff = {
    kind: "text",
    unified: `@@ -0,0 +1,52 @@\n+DIFF_START\n${longCode}\n${Array.from({ length: 49 }, (_, i) => `+code line ${i + 3}\n`).join("")}+DIFF_END\n`,
  };
  review.snapshot.sections = [
    {
      title: "Ungrouped changes",
      explanation: "Inspect these changes separately.",
      references: [{ kind: "file", fileId: "greeting" }],
    },
  ];
  review.analysis = analyzeDiffs(review.snapshot);
  const ui = await createTestRenderer({ width: 100, height: 22 });
  try {
    mountReview(ui.renderer, review);
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Ungrouped changes");
    expect(ui.captureCharFrame()).toContain("DIFF_START");
    expect(ui.captureCharFrame()).toContain("WRAP_END");
    expect(ui.captureCharFrame()).not.toContain("DIFF_END");
    ui.resize(32, 22);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("DIFF_START");
    // A long unbroken code line is wrapped, including its final characters.
    await ui.mockInput.pressKeys(["j", "j", "j", "j"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("WRAP_END");
    await ui.mockInput.pressKeys(Array(20).fill("\u001b[6~"));
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("52 | +DIFF_END");
    expect(ui.captureCharFrame()).not.toContain("DIFF_START");
    ui.resize(72, 16);
    await ui.renderOnce();
    await ui.mockInput.pressKeys(Array(20).fill("\u001b[5~"));
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("DIFF_START");
    await ui.mockInput.pressKeys(["s"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).not.toContain("DIFF_START");
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("DIFF_START");
  } finally {
    await ui.dispose();
  }
});

test("long explanations scroll, wrap on resize, and reset when changing sections", async () => {
  const review = await loadReview(fixture);
  review.snapshot.sections[0].explanation = Array.from(
    { length: 60 },
    (_, index) => `Narrative line ${index + 1}: review this behavior.`,
  ).join("\n");
  const ui = await createTestRenderer({ width: 80, height: 20 });
  try {
    mountReview(ui.renderer, review);
    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Narrative line 1:");
    expect(ui.captureCharFrame()).not.toContain("Narrative line 60:");
    await ui.mockInput.pressKeys(["j", KeyCodes.ARROW_DOWN, "\u001b[6~"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).not.toContain("Narrative line 1:");
    expect(ui.captureCharFrame()).toContain("q/Ctrl+C: quit");
    await ui.mockInput.pressKeys(["\u001b[5~", "k", KeyCodes.ARROW_UP]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Narrative line 1:");
    ui.resize(40, 20);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Narrative line 1: review this");
    expect(ui.captureCharFrame()).toContain("behavior.");
    await ui.mockInput.pressKeys(["n", "p"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Narrative line 1:");
  } finally {
    await ui.dispose();
  }
});

test("an artifact without sections stays on summary and Ctrl+C closes cleanly", async () => {
  const review = await loadReview(fixture);
  review.snapshot.sections = [];
  const ui = await createTestRenderer({ width: 100, height: 45 });
  try {
    mountReview(ui.renderer, review);
    await ui.mockInput.pressKeys(["n", KeyCodes.END, "p"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("#42 · Summary");
    expect(ui.captureCharFrame()).toContain("(No sections)");
    ui.mockInput.pressCtrlC();
    await ui.renderer.closed;
  } finally {
    await ui.dispose();
  }
});
