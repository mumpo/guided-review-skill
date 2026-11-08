import { expect, test } from "bun:test";
import {
  RGBA,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { resolveKeybindings } from "../../../packages/preferences/src";
import { mountReview } from "./view";
import { sessionHighlights } from "./highlight-service";
import { themes } from "./theme";

function data() {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: continuous section and file jumps, clicks, and retained folding`, async () => {
      const ui = await createTestRenderer({ width: 140, height: 28 });
      try {
        mountReview(ui.renderer, data(), theme, mode);
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const sidebar = ui.renderer.root.findDescendantById(
          "sidebar",
        ) as ScrollBoxRenderable;
        const heading = ui.renderer.root.findDescendantById(
          "heading",
        ) as TextRenderable;
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        expect(sidebar.visible).toBe(true);
        expect(body.getChildren()).toHaveLength(4);
        await press("n", "p", "h", "l", "\u001b[C", "\u001b[D");
        expect(heading.plainText).toContain("Summary");
        await press("\u000e");
        expect(heading.plainText).toContain("Section 1/3");
        expect(body.scrollTop).toBeGreaterThan(0);
        const sectionTop = body.scrollTop;
        await press("\t");
        expect(body.scrollTop).toBeGreaterThan(sectionTop);
        await press("z");
        const file = ui.renderer.root.findDescendantById(
          "file-header-greeting",
        );
        expect(file).toBeDefined();
        await press("\u000e", "\u0010");
        expect(ui.captureCharFrame()).not.toContain("+hello world");
        await press("\t", "z");
        expect(ui.captureCharFrame()).toContain("+hello world");
        const nextSection = ui.renderer.root.findDescendantById(
          "navigation-4",
        ) as TextRenderable;
        await ui.mockMouse.click(nextSection.x + 1, nextSection.y);
        await ui.renderOnce();
        expect(heading.plainText).toContain("Section 2/3");
        await press("\u0010", "\u0010", "\u0010");
        expect(body.scrollTop).toBe(0);
        await press("\u001b[Z");
        expect(body.scrollTop).toBe(0);
        await press(...Array(20).fill("\t"));
        expect(heading.plainText).toContain("Section 3/3");
        await press("s");
        expect(body.scrollTop).toBe(0);
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("custom keys, conflict winner, help, sidebar widths, and removed interrupts", async () => {
  const ui = await createTestRenderer({ width: 140, height: 30 });
  try {
    const bindings = resolveKeybindings({
      next_section: ["x"],
      toggle_sidebar: ["x"],
      next_item: ["f"],
      interrupt: ["ctrl+x"],
    });
    mountReview(ui.renderer, data(), undefined, "auto", undefined, bindings);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();
    const sidebar = ui.renderer.root.findDescendantById(
      "sidebar",
    ) as ScrollBoxRenderable;
    const body = ui.renderer.root.findDescendantById(
      "body",
    ) as ScrollBoxRenderable;
    const heading = ui.renderer.root.findDescendantById(
      "heading",
    ) as TextRenderable;
    const width = body.viewport.width;
    await ui.mockInput.pressKeys(["x"]);
    await ui.renderOnce();
    expect(sidebar.visible).toBe(false);
    expect(body.viewport.width).toBeGreaterThan(width);
    expect(heading.plainText).toContain("Summary");
    await ui.mockInput.pressKeys(["f"]);
    await ui.renderOnce();
    expect(heading.plainText).toContain("Section 1/3");
    expect(ui.captureCharFrame()).toContain("unbound/ctrl+p: sections");
    ui.resize(60, 30);
    await ui.renderOnce();
    await ui.mockInput.pressKeys(["x"]);
    await ui.renderOnce();
    expect(sidebar.visible).toBe(true);
    expect(sidebar.width).toBeLessThanOrEqual(24);
    ui.mockInput.pressCtrlC();
    await ui.renderOnce();
    expect(ui.renderer.isDestroyed).toBe(false);
    await ui.mockInput.pressKeys(["\u0018"]);
    await ui.renderer.closed;
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("one cursor crosses section boundaries in both directions and tracks the sidebar", async () => {
  const review = data();
  review.snapshot.sections = [
    { title: "First", explanation: "First narrative", references: [] },
    { title: "Second", explanation: "Second narrative", references: [] },
  ];
  review.analysis = analyzeDiffs(review.snapshot);
  const ui = await createTestRenderer({ width: 140, height: 24 });
  try {
    mountReview(ui.renderer, review);
    await sessionHighlights(ui.renderer).settled();
    await ui.mockInput.pressKeys(["\u000e", "j", "j"]);
    await ui.renderOnce();
    const heading = ui.renderer.root.findDescendantById(
      "heading",
    ) as TextRenderable;
    const second = ui.renderer.root.findDescendantById(
      "navigation-2",
    ) as TextRenderable;
    expect(heading.plainText).toContain("Section 2/2");
    expect(
      second.bg?.equals(
        RGBA.fromHex(themes["github-dark"].navigation.background),
      ),
    ).toBe(true);
    await ui.mockInput.pressKeys(["k"]);
    await ui.renderOnce();
    expect(heading.plainText).toContain("Section 1/2");
    expect(
      second.bg?.equals(RGBA.fromHex(themes["github-dark"].background)),
    ).toBe(true);
    await ui.mockInput.pressKeys(["\t"]);
    await ui.renderOnce();
    expect(heading.plainText).toContain("Section 2/2");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("sidebar scrolls to selected destinations and truncates Unicode paths", async () => {
  const review = data();
  const path = `packages/${"很长的目录/".repeat(12)}http-service.go`;
  review.snapshot.files[0].oldPath = path;
  review.snapshot.files[0].newPath = path;
  review.snapshot.sections = Array.from({ length: 25 }, (_, index) => ({
    title: `Section ${index}`,
    explanation: "Inspect the change.",
    references: [{ kind: "file" as const, fileId: "greeting" }],
  }));
  review.analysis = analyzeDiffs(review.snapshot);
  const ui = await createTestRenderer({ width: 140, height: 22 });
  try {
    mountReview(ui.renderer, review);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();
    const sidebar = ui.renderer.root.findDescendantById(
      "sidebar",
    ) as ScrollBoxRenderable;
    const file = ui.renderer.root.findDescendantById(
      "navigation-2",
    ) as TextRenderable;
    expect(file.plainText).toContain("...");
    expect(file.plainText).toEndWith("http-service.go");
    expect(Bun.stringWidth(file.plainText)).toBeLessThanOrEqual(30);
    await ui.mockInput.pressKeys(["\u001b[F", "\t"]);
    await ui.renderOnce();
    expect(sidebar.scrollTop).toBeGreaterThan(0);
    const selected = ui.renderer.root.findDescendantById(
      "navigation-50",
    ) as TextRenderable;
    expect(selected.y).toBeGreaterThanOrEqual(sidebar.viewport.y);
    expect(selected.y).toBeLessThan(
      sidebar.viewport.y + sidebar.viewport.height,
    );
    ui.resize(90, 22);
    await ui.renderOnce();
    expect(sidebar.visible).toBe(false);
    ui.resize(140, 22);
    await ui.renderOnce();
    expect(sidebar.visible).toBe(true);
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});
