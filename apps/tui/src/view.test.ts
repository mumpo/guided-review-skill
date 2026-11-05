import { expect, test } from "bun:test";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
import { analyzeDiffs } from "../../../packages/core/src";
import { loadReview } from "./load";
import { mountReview } from "./view";
import { RGBA } from "@opentui/core";
import { themes } from "./theme";
import { startTheme } from "./theme-session";

const fixture = new URL(
  "../../../packages/core/fixtures/valid.json",
  import.meta.url,
).pathname;

test("both themes paint explicit readable colors without changing displayed content", async () => {
  const review = await loadReview(fixture);
  const frames: string[] = [];
  for (const theme of Object.values(themes)) {
    const ui = await createTestRenderer({ width: 100, height: 45 });
    try {
      mountReview(ui.renderer, review, theme);
      await ui.renderOnce();
      frames.push(ui.captureCharFrame());
      const spans = () => ui.captureSpans().lines.flatMap((line) => line.spans);
      function expectColor(text: string, fg: string, bg: string) {
        const span = spans().find((span) => span.text.includes(text));
        expect(span).toBeDefined();
        expect(span?.fg.equals(RGBA.fromHex(fg))).toBe(true);
        expect(span?.bg.equals(RGBA.fromHex(bg))).toBe(true);
      }
      expectColor(
        "#42 · Summary",
        theme.navigation.foreground,
        theme.navigation.background,
      );
      expectColor("Update the greeting", theme.text, theme.background);
      expectColor("q/Ctrl+C: quit", theme.muted, theme.surface);
      // The viewport margin is painted too, even when the terminal has the opposite appearance.
      expect(spans()[0].bg.equals(RGBA.fromHex(theme.background))).toBe(true);
      await ui.mockInput.pressKeys(["n"]);
      await ui.renderOnce();
      expect(ui.captureCharFrame()).not.toContain("greeting -> guide");
      expect(ui.captureCharFrame()).toContain("+hello world");
      const sign = spans().find((span) => span.text === "+");
      expect(
        sign?.fg.equals(RGBA.fromHex(theme.diff.addition.foreground)),
      ).toBe(true);
      expect(
        sign?.bg.equals(RGBA.fromHex(theme.diff.addition.background)),
      ).toBe(true);
      frames.push(ui.captureCharFrame());
    } finally {
      await ui.dispose();
    }
  }
  expect(frames[0]).toBe(frames[2]);
  expect(frames[1]).toBe(frames[3]);
});

test("live appearance changes preserve page, scroll position, and resizing", async () => {
  const review = await loadReview(fixture);
  review.snapshot.sections[0].explanation = Array.from(
    { length: 80 },
    (_, i) => `Narrative line ${i + 1}`,
  ).join("\n");
  const ui = await createTestRenderer({ width: 65, height: 20 });
  try {
    const apply = mountReview(ui.renderer, review);
    await startTheme(ui.renderer, "auto", apply);
    await ui.mockInput.pressKeys(["n", "j", "j", "j", "j", "j"]);
    await ui.renderOnce();
    const before = ui.captureCharFrame();
    ui.renderer.emit("theme_mode", "light");
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toBe(before);
    const heading = ui
      .captureSpans()
      .lines[0].spans.find((span) => span.text.includes("#42"));
    expect(
      heading?.fg.equals(
        RGBA.fromHex(themes["github-light"].navigation.foreground),
      ),
    ).toBe(true);
    ui.resize(35, 20);
    await ui.renderOnce();
    const narrow = ui.captureCharFrame();
    ui.renderer.emit("theme_mode", "dark");
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toBe(narrow);
    expect(narrow).toContain("Narrative line");
  } finally {
    await ui.dispose();
  }
});

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
    expect(ui.captureCharFrame()).not.toContain("Diagram");
    expect(ui.captureCharFrame()).not.toContain("greeting -> guide");
    expect(ui.captureCharFrame()).toContain("File: src/greeting.ts (modified)");
    expect(ui.captureCharFrame()).toContain("  1         -hello");
    expect(ui.captureCharFrame()).toContain("        1   +hello world");
    expect(ui.captureCharFrame()).toContain("guide.md -> docs/guide.md");
    expect(ui.captureCharFrame()).not.toContain("-goodbye");
    await ui.mockInput.pressKeys([KeyCodes.ARROW_RIGHT]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 2/3: Farewell");
    expect(ui.captureCharFrame()).toContain(" 10         -goodbye");
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
    expect(ui.captureCharFrame()).toContain("52   +DIFF_END");
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
