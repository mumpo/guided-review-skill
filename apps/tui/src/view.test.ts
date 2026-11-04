import { expect, test } from "bun:test";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
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
    await ui.mockInput.pressKeys([KeyCodes.ARROW_RIGHT]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 2/3: Farewell");
    ui.mockInput.pressTab();
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Section 3/3: Other files");
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
