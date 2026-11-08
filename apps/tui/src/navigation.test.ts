import { expect, test } from "bun:test";
import {
  RGBA,
  type BoxRenderable,
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
import { cursorBackground } from "./cursor-highlight";

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
        RGBA.fromHex(
          cursorBackground(themes["github-dark"].surface, "github-dark"),
        ),
      ),
    ).toBe(true);
    await ui.mockInput.pressKeys(["k"]);
    await ui.renderOnce();
    expect(heading.plainText).toContain("Section 1/2");
    expect(second.bg?.equals(RGBA.fromHex(themes["github-dark"].surface))).toBe(
      true,
    );
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

for (const mode of ["inline", "side-by-side"] as const) {
  test(`${mode}: sidebar bullets, separators, file icons, and borders follow both themes`, async () => {
    const review = data();
    review.snapshot.files.push({
      ...review.snapshot.files[0],
      id: "deleted",
      status: "deleted",
      oldPath: "deleted.go",
      newPath: null,
      diff: { kind: "unavailable", reason: "Deleted file" },
    });
    review.snapshot.sections[0].references = review.snapshot.files.map(
      (file) => ({ kind: "file", fileId: file.id }),
    );
    review.analysis = analyzeDiffs(review.snapshot);
    const ui = await createTestRenderer({ width: 140, height: 40 });
    try {
      const applyTheme = mountReview(
        ui.renderer,
        review,
        themes["github-light"],
        mode,
      );
      await sessionHighlights(ui.renderer).settled();
      await ui.renderOnce();
      const sidebar = ui.renderer.root.findDescendantById(
        "sidebar",
      ) as ScrollBoxRenderable;
      const section = ui.renderer.root.findDescendantById(
        "navigation-1",
      ) as TextRenderable;
      expect(section.plainText).toBe("\uf51e Greeting");
      expect(section.plainText).not.toContain("1.");
      const icons = [
        ["\uf4d0", "#1a7f37", "#3fb950"],
        ["\uf4d2", "#59636e", "#9198a1"],
        ["\uf4d6", "#d1242f", "#f85149"],
        ["\uf4d5", "#9a6700", "#d29922"],
      ];
      for (const theme of Object.values(themes)) {
        applyTheme(theme);
        await ui.renderOnce();
        await ui.mockInput.pressKeys(["s"]);
        await ui.renderOnce();
        expect(section.fg?.equals(RGBA.fromHex(theme.muted))).toBe(true);
        expect(section.bg?.equals(RGBA.fromHex(theme.surface))).toBe(true);
        const sectionSpans = ui.captureSpans().lines[section.y].spans;
        const bullet = sectionSpans.find((span) =>
          span.text.includes("\uf51e"),
        );
        const label = sectionSpans.find((span) =>
          span.text.includes("Greeting"),
        );
        for (const span of [bullet, label]) {
          expect(span?.fg.equals(RGBA.fromHex(theme.muted))).toBe(true);
          expect(span?.bg.equals(RGBA.fromHex(theme.surface))).toBe(true);
        }
        await ui.mockInput.pressKeys(["\t"]);
        await ui.renderOnce();
        expect(section.fg?.equals(RGBA.fromHex(theme.muted))).toBe(true);
        expect(
          section.bg?.equals(
            RGBA.fromHex(cursorBackground(theme.surface, theme.name)),
          ),
        ).toBe(true);
        const border = theme.name === "github-light" ? "#d1d9e0" : "#3d444d";
        expect(sidebar.borderColor.equals(RGBA.fromHex(border))).toBe(true);
        for (const id of [
          "description-separator",
          "section-separator-2",
          "sidebar-separator-1",
          "sidebar-separator-2",
          "sidebar-separator-3",
          "file-header-greeting",
        ]) {
          const node = ui.renderer.root.findDescendantById(id) as BoxRenderable;
          expect(node.borderColor.equals(RGBA.fromHex(border))).toBe(true);
        }
        const separator = ui.renderer.root.findDescendantById(
          "sidebar-separator-2",
        ) as BoxRenderable;
        expect(separator.y).toBeGreaterThan(section.y);
        expect(separator.height).toBe(1);
        const spans = ui.captureSpans().lines.flatMap((line) => line.spans);
        for (const [icon, light, dark] of icons) {
          const span = spans.find((span) => span.text.includes(icon));
          expect(
            span?.fg.equals(
              RGBA.fromHex(theme.name === "github-light" ? light : dark),
            ),
          ).toBe(true);
        }
        await ui.mockInput.pressKeys(["s", "\t", "\t"]);
        await ui.renderOnce();
        const selectedIcon = ui
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find(
            (span) =>
              span.text.includes("\uf4d2") &&
              span.bg.equals(RGBA.fromHex(theme.navigation.background)),
          );
        expect(
          selectedIcon?.fg.equals(RGBA.fromHex(theme.fileStatus.modified)),
        ).toBe(true);
      }
    } finally {
      await sessionHighlights(ui.renderer).settled();
      await ui.dispose();
    }
  });
}
