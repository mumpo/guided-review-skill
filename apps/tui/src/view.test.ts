import { expect, test } from "bun:test";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
import { analyzeDiffs } from "../../../packages/core/src";
import { loadReview } from "./load";
import { mountReview } from "./view";
import {
  type BoxRenderable,
  RGBA,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { themes } from "./theme";
import { startTheme } from "./theme-session";
import { sessionHighlights } from "./highlight-service";

const fixture = new URL(
  "../../../packages/core/fixtures/valid.json",
  import.meta.url,
).pathname;

test("summary separates metadata from the unlabeled description in both themes and layouts", async () => {
  for (const theme of Object.values(themes)) {
    for (const mode of ["inline", "side-by-side"] as const) {
      const review = await loadReview(fixture);
      review.snapshot.summary = "This generated summary must stay hidden.";
      review.snapshot.pullRequest.description = `Description starts here\n\n${"Scrollable description\n".repeat(60)}`;

      const ui = await createTestRenderer({ width: 100, height: 45 });

      try {
        const applyTheme = mountReview(ui.renderer, review, theme, mode);
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();

        const frame = ui.captureCharFrame();
        const separator = ui.renderer.root.findDescendantById(
          "description-separator",
        ) as BoxRenderable;
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const wideWidth = separator.width;
        const line = frame.split("\n").find((row) => row.includes("─"));

        expect(frame).not.toContain(review.snapshot.summary);
        expect(frame).not.toContain("PR description");
        expect(line?.match(/─+/)?.[0]).toBe("─".repeat(wideWidth));
        expect(
          frame.indexOf(review.snapshot.pullRequest.headCommit),
        ).toBeLessThan(frame.indexOf("─"));
        expect(frame.indexOf("─")).toBeLessThan(
          frame.indexOf("Description starts here"),
        );
        expect(separator.borderColor.equals(RGBA.fromHex(theme.muted))).toBe(
          true,
        );

        await ui.mockInput.pressKeys(["j"]);
        await ui.renderOnce();

        const scrollTop = body.scrollTop;
        const nextTheme =
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ];
        applyTheme(nextTheme);
        await ui.renderOnce();

        expect(scrollTop).toBeGreaterThan(0);
        expect(body.scrollTop).toBe(scrollTop);
        expect(
          ui.renderer.root.findDescendantById("description-separator"),
        ).toBe(separator);
        expect(
          separator.borderColor.equals(RGBA.fromHex(nextTheme.muted)),
        ).toBe(true);

        ui.resize(45, 45);
        await ui.renderOnce();

        expect(separator.width).toBeLessThan(wideWidth);
        expect(separator.width).toBeGreaterThan(0);

        review.snapshot.pullRequest.description = "";
        await ui.mockInput.pressKeys(["n"]);
        await ui.renderOnce();

        expect(
          ui.renderer.root.findDescendantById("description-separator"),
        ).toBeUndefined();

        await ui.mockInput.pressKeys(["s"]);
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toContain("(No description)");
        expect(ui.captureCharFrame()).not.toContain("(No summary)");
        expect(
          ui.renderer.root.findDescendantById("description-separator"),
        ).toBeDefined();
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    }
  }
});

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

      // Plain source can share a rendered span with its unchanged-color sign.
      const sign = spans().find(
        (span) => span.text === "+" || span.text.startsWith("+hello"),
      );

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
    await ui.mockInput.pressKeys(["n", ...Array(5).fill(KeyCodes.ARROW_DOWN)]);
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
    expect(frame).not.toContain(review.snapshot.summary);
    expect(frame).toContain(review.snapshot.pullRequest.description);
    expect(frame).not.toContain("PR description");
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
    expect(ui.captureCharFrame()).toContain("src/greeting.ts");
    expect(ui.captureCharFrame()).toContain("  1        ▸-hello");
    expect(ui.captureCharFrame()).toContain("        1   +hello world");
    expect(ui.captureCharFrame()).toContain("guide.md → docs/guide.md");
    expect(ui.captureCharFrame()).not.toContain("-goodbye");

    await ui.mockInput.pressKeys([KeyCodes.ARROW_RIGHT]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("Section 2/3: Farewell");
    expect(ui.captureCharFrame()).toContain(" 10        ▸-goodbye");
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

    await ui.mockInput.pressKeys([
      KeyCodes.ARROW_DOWN,
      KeyCodes.ARROW_DOWN,
      "\u001b[6~",
    ]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).not.toContain("Narrative line 1:");
    expect(ui.captureCharFrame()).toContain("q/Ctrl+C: quit");

    await ui.mockInput.pressKeys([
      "\u001b[5~",
      KeyCodes.ARROW_UP,
      KeyCodes.ARROW_UP,
    ]);
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

test("arrows scroll by line, control motions scroll half viewport, and section navigation is bounded", async () => {
  for (const theme of Object.values(themes)) {
    for (const mode of ["inline", "side-by-side"] as const) {
      const review = await loadReview(fixture);
      review.snapshot.sections[0].explanation = Array.from(
        { length: 80 },
        (_, i) => `Narrative ${i + 1}: ${"wrapped words ".repeat(8)}`,
      ).join("\n");

      const ui = await createTestRenderer({ width: 100, height: 24 });

      try {
        const applyTheme = mountReview(ui.renderer, review, theme, mode);
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };

        await press("h");

        expect(ui.captureCharFrame()).toContain("#42 · Summary");

        await press("l");

        expect(ui.captureCharFrame()).toContain("Section 1/3: Greeting");

        await press(KeyCodes.ARROW_DOWN);

        expect(body.scrollTop).toBe(1);

        await press(KeyCodes.ARROW_UP);

        expect(body.scrollTop).toBe(0);

        await press("\u0004"); // Ctrl+d

        expect(body.scrollTop).toBe(Math.floor(body.viewport.height / 2));
        expect(ui.captureCharFrame()).toContain(`d: diff ${mode}`);

        await press("\u0015"); // Ctrl+u

        expect(body.scrollTop).toBe(0);

        ui.resize(55, 18);
        await ui.renderOnce();
        await press("\u0004");

        const halfPage = Math.floor(body.viewport.height / 2);

        expect(body.scrollTop).toBe(halfPage);

        applyTheme(themes["github-light"]);
        await ui.renderOnce();

        expect(body.scrollTop).toBe(halfPage);

        await press("\u0015", "\u0015");

        expect(body.scrollTop).toBe(0);

        await press(...Array(100).fill("\u0004"));

        const bottom = body.scrollTop;

        expect(bottom).toBeGreaterThan(halfPage);

        await press("\u0004");

        expect(body.scrollTop).toBe(bottom);

        await press("l", "h");

        expect(ui.captureCharFrame()).toContain("Section 1/3: Greeting");
        expect(body.scrollTop).toBe(0);

        await press("h");

        expect(ui.captureCharFrame()).toContain("#42 · Summary");

        await press("l", "l", "l", "l");

        expect(ui.captureCharFrame()).toContain("Section 3/3: Other files");
      } finally {
        await ui.dispose();
      }
    }
  }
});

test("an artifact without sections stays on summary and Ctrl+C closes cleanly", async () => {
  const review = await loadReview(fixture);
  review.snapshot.sections = [];

  const ui = await createTestRenderer({ width: 100, height: 45 });

  try {
    mountReview(ui.renderer, review);
    await ui.mockInput.pressKeys(["n", KeyCodes.END, "p", "h", "l"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("#42 · Summary");
    expect(ui.captureCharFrame()).toContain("(No sections)");

    ui.mockInput.pressCtrlC();
    await ui.renderer.closed;
  } finally {
    await ui.dispose();
  }
});
