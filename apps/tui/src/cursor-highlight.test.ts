import { expect, test } from "bun:test";
import {
  BoxRenderable,
  RGBA,
  type Renderable,
  type ScrollBoxRenderable,
  TextAttributes,
  type TextRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { cursorBackground } from "./cursor-highlight";
import { diffGutterBackground, type Theme, themes } from "./theme";
import { mountFullWidthReview as mountReview } from "./view-test-utils";
import { sessionHighlights } from "./highlight-service";

function selectedBox(root: Renderable, theme: Theme): BoxRenderable {
  const boxes: BoxRenderable[] = [];
  const walk = (node: Renderable) => {
    if (
      node instanceof BoxRenderable &&
      [
        theme.background,
        theme.markdown.codeBackground,
        theme.diff.addition.background,
        theme.diff.deletion.background,
      ].some((base) =>
        node.backgroundColor.equals(
          RGBA.fromHex(cursorBackground(base, theme.name)),
        ),
      )
    )
      boxes.push(node);
    for (const child of node.getChildren()) walk(child);
  };

  walk(root);
  expect(boxes).toHaveLength(1);

  return boxes[0];
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: full-width background highlights preserve source, styles, and layout`, async () => {
      const snapshot = structuredClone(fixture) as ReviewSnapshot;
      const old = `const previous = "${"old 🐱 ".repeat(24)}";`;
      const next = `const current = "${"new 🐱 ".repeat(24)}";`;
      snapshot.files[0].diff = {
        kind: "text",
        unified: `@@ -1 +1 @@\n-${old}\n+${next}\n`,
      };
      snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];
      snapshot.sections[0].explanation =
        "A **bold** narrative line\nContinuation";
      const ui = await createTestRenderer({ width: 120, height: 45 });

      try {
        let currentTheme = theme;
        const applyTheme = mountReview(
          ui.renderer,
          { snapshot, analysis: analyzeDiffs(snapshot) },
          theme,
          mode,
          async () => {
            throw new Error("No publication expected");
          },
        );
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        const checkHighlight = (width: number) => {
          const box = selectedBox(ui.renderer.root, currentTheme);
          expect(box.width).toBe(width);
          expect(box.border).toBe(false);
          expect(box.renderAfter).toBeUndefined();
          const frame = ui.captureSpans();
          for (
            let y = Math.max(box.y, body.viewport.y);
            y <
            Math.min(
              box.y + box.height,
              body.viewport.y + body.viewport.height,
            );
            y++
          ) {
            let x = 0;
            for (const span of frame.lines[y].spans) {
              if (
                (x <= box.x && x + span.width > box.x) ||
                (x <= box.x + box.width - 1 &&
                  x + span.width > box.x + box.width - 1)
              )
                expect(
                  [
                    currentTheme.background,
                    currentTheme.markdown.codeBackground,
                    currentTheme.diff.addition.background,
                    currentTheme.diff.deletion.background,
                    currentTheme.surface,
                    currentTheme.diff.addition.spanBackground,
                    currentTheme.diff.deletion.spanBackground,
                    diffGutterBackground(currentTheme, "addition"),
                    diffGutterBackground(currentTheme, "deletion"),
                  ].some((base) =>
                    span.bg.equals(
                      RGBA.fromHex(cursorBackground(base, currentTheme.name)),
                    ),
                  ),
                ).toBe(true);
              x += span.width;
            }
          }
          expect(ui.captureCharFrame()).not.toContain("▸");

          return box;
        };
        await press("\u000e", "j");
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();

        const narrativeBox = checkHighlight(body.viewport.width);
        const narrativeText = narrativeBox.getChildren()[0] as TextRenderable;
        expect(narrativeBox.height).toBe(narrativeText.height);
        const narrativeBounds = {
          y: narrativeBox.y,
          height: narrativeBox.height,
          textX: narrativeText.x,
          textWidth: narrativeText.width,
        };
        await press("j");

        expect(
          narrativeBox.backgroundColor.equals(RGBA.fromHex(theme.background)),
        ).toBe(true);
        expect({
          y: narrativeBox.y,
          height: narrativeBox.height,
          textX: narrativeText.x,
          textWidth: narrativeText.width,
        }).toEqual(narrativeBounds);
        await press("k");

        const bold = ui
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text === "bold");
        expect((bold?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
        expect((bold?.attributes ?? 0) & TextAttributes.UNDERLINE).toBe(0);
        await press("j", "j", "j");

        const box = checkHighlight(
          mode === "inline"
            ? body.viewport.width
            : Math.floor((body.viewport.width - 3) / 2),
        );
        const code = box.getChildren()[0] as TextRenderable;
        expect(code.plainText).toContain(
          mode === "inline" ? `-${old}` : `+${next}`,
        );
        expect(code.attributes & TextAttributes.UNDERLINE).toBe(0);
        expect(box.height).toBe(code.height);
        expect(code.y).toBe(box.y);
        const before = {
          y: box.y,
          height: box.height,
          textX: code.x,
          textWidth: code.width,
        };
        await press("k");

        expect({
          y: box.y,
          height: box.height,
          textX: code.x,
          textWidth: code.width,
        }).toEqual(before);
        const unselectedChunks = code.content.chunks;
        const base =
          mode === "inline"
            ? theme.diff.deletion.background
            : theme.diff.addition.background;
        expect(box.backgroundColor.equals(RGBA.fromHex(base))).toBe(true);
        await press("j");

        code.content.chunks.forEach((chunk, index) => {
          const previous = unselectedChunks[index];
          expect(chunk.text).toBe(previous.text);
          expect(chunk.fg?.equals(previous.fg)).toBe(true);
          expect(
            chunk.bg?.equals(
              RGBA.fromHex(cursorBackground(previous.bg ?? base, theme.name)),
            ),
          ).toBe(true);
        });
        expect(code.height).toBeGreaterThan(1);
        if (mode === "side-by-side") {
          const other = box.parent
            ?.getChildren()
            .find(
              (child) =>
                child !== box &&
                child instanceof BoxRenderable &&
                child.width > 3,
            );
          expect(other?.getChildren()[0].y).toBe(code.y);
          await press(" ");

          expect(selectedBox(ui.renderer.root, currentTheme).x).toBeLessThan(
            box.x,
          );
        }

        currentTheme =
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ];
        applyTheme(currentTheme);
        ui.resize(90, 45);
        await ui.renderOnce();

        checkHighlight(selectedBox(ui.renderer.root, currentTheme).width);
        await press("c");

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(true);
        await press("\u001b[27u", "k", "k");

        expect(selectedBox(ui.renderer.root, currentTheme).width).toBe(
          body.viewport.width,
        );
        expect(
          ui
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .some((span) => span.attributes & TextAttributes.UNDERLINE),
        ).toBe(false);
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: cursor backgrounds fill every selected row through scrolling and resizing`, async () => {
      const snapshot = structuredClone(fixture) as ReviewSnapshot;
      snapshot.pullRequest.description = `Short description.\n\n${"Long description. ".repeat(30)}`;
      snapshot.sections[0].explanation = `Short explanation.\n\n- List item\n  - Nested item\n\n${"Wrapped explanation. ".repeat(30)}`;
      snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];
      snapshot.files[0].diff = {
        kind: "text",
        unified:
          "@@ -1,12 +1,12 @@\n" +
          Array.from({ length: 12 }, (_, i) => `-${i} old\n+${i} new\n`).join(
            "",
          ),
      };
      const ui = await createTestRenderer({ width: 120, height: 25 });

      try {
        mountReview(
          ui.renderer,
          { snapshot, analysis: analyzeDiffs(snapshot) },
          theme,
          mode,
        );
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const checkRows = () => {
          const box = selectedBox(ui.renderer.root, theme);
          const frame = ui.captureSpans();
          for (
            let y = Math.max(box.y, body.viewport.y);
            y <
            Math.min(
              box.y + box.height,
              body.viewport.y + body.viewport.height,
            );
            y++
          ) {
            let x = 0;
            let highlightedWidth = 0;
            for (const span of frame.lines[y].spans) {
              const width = Math.max(
                0,
                Math.min(x + span.width, box.x + box.width) -
                  Math.max(x, box.x),
              );
              if (span.bg.equals(box.backgroundColor))
                highlightedWidth += width;
              x += span.width;
            }
            // Diff gutters and inline code can keep their own tinted backgrounds.
            expect(highlightedWidth).toBeGreaterThan(0);
            expect(box.border).toBe(box.id.startsWith("file-header-"));
            expect(box.renderAfter).toBeUndefined();
          }
        };
        for (const width of [120, 55, 32, 90]) {
          ui.resize(width, 25);
          await ui.mockInput.pressKeys(["s"]);
          await ui.renderOnce();
          checkRows();
          await ui.mockInput.pressKeys(["\u000e"]);
          await ui.renderOnce();
          checkRows();
          for (let i = 0; i < 29; i++) {
            await ui.mockInput.pressKeys(["j"]);
            await ui.renderOnce();
            checkRows();
          }
        }
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("cursor backgrounds become subtly brighter in dark mode and darker in light mode", () => {
  expect(cursorBackground("#0d1117", "github-dark")).toBe("#20242a");
  expect(cursorBackground("#ffffff", "github-light")).toBe("#f0f0f0");
  for (const theme of Object.values(themes)) {
    for (const base of [
      theme.background,
      theme.markdown.codeBackground,
      theme.diff.addition.background,
      theme.diff.deletion.background,
      theme.diff.addition.spanBackground,
      theme.diff.deletion.spanBackground,
    ]) {
      const original = RGBA.fromHex(base);
      const highlighted = RGBA.fromHex(cursorBackground(original, theme.name));
      for (const channel of ["r", "g", "b"] as const) {
        if (theme.name === "github-dark")
          expect(highlighted[channel]).toBeGreaterThan(original[channel]);
        else expect(highlighted[channel]).toBeLessThan(original[channel]);
      }
      expect(original.equals(RGBA.fromHex(base))).toBe(true);
    }
  }
});
