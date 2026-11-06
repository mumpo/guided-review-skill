import { expect, spyOn, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { reviewSyntaxSamples } from "./highlight-preload";
import { sessionHighlights } from "./highlight-service";
import { mountReview } from "./view";

function review() {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;

  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

test("startup discovers distinct path and eligible narrative languages using selected source only", () => {
  const data = review();
  data.snapshot.files[1].oldPath = "guide.py";
  data.snapshot.sections[0].references.push({
    kind: "lines",
    fileId: "guide",
    side: "old",
    startLine: 1,
    endLine: 1,
  });
  data.snapshot.summary =
    "```rs\nlet answer = 42;\n```\n\n```unknown\nplain\n```";
  data.snapshot.pullRequest.description =
    "- Example:\n\n  ```bash\n  echo hello\n  ```";
  data.snapshot.sections[0].explanation =
    "```yaml\nok: true\n```\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n> ```sql\n> SELECT 1\n> ```\n\n```java\nunclosed";
  data.snapshot.files.push({
    id: "unselected",
    status: "added",
    oldPath: null,
    newPath: "unselected.json",
    diff: { kind: "unavailable", reason: "not captured" },
  });
  data.analysis = analyzeDiffs(data.snapshot);

  const samples = reviewSyntaxSamples(data);
  const sources = new Map(
    samples.map(({ language, source }) => [language, source]),
  );

  expect([...sources.keys()].sort()).toEqual(
    [
      "rust",
      "shellscript",
      "yaml",
      "typescript",
      "python",
      "markdown",
      "json",
    ].sort(),
  );
  expect(sources.get("typescript")).toBe("hello");
  expect(sources.get("python")).toBe("Old guide");
  expect(sources.get("markdown")).toBe("New guide");
  expect(sources.get("shellscript")).toBe("echo hello");
  expect(sources.get("json")).toBe("");
  expect(samples.some(({ source }) => source.includes("goodbye"))).toBe(false);
});

test("summary starts worker warm-up before navigation, without waiting for syntax", async () => {
  const ui = await createTestRenderer({ width: 100, height: 30 });
  const data = review();
  const preload = spyOn(sessionHighlights(ui.renderer), "preload");

  try {
    mountReview(ui.renderer, data);
    await ui.renderOnce();

    expect(preload).toHaveBeenCalledWith(reviewSyntaxSamples(data));
    expect(ui.captureCharFrame()).toContain("Summary");
    expect(ui.captureCharFrame()).not.toContain("+hello world");
    // Completion before any navigation proves warming is triggered at startup.
    await sessionHighlights(ui.renderer).settled();
    const samples = reviewSyntaxSamples(data);
    const first = samples.find(({ language }) => language === "typescript");

    expect(first).toBeDefined();
    expect(
      await sessionHighlights(ui.renderer).highlight(
        first?.source ?? "",
        first?.language,
      ),
    ).toBeDefined();
    await ui.mockInput.pressKeys(["n"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("+hello world");
  } finally {
    preload.mockRestore();
    await ui.dispose();
  }
});
