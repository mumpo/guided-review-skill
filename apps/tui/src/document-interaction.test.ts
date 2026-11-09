import { expect, test } from "bun:test";
import {
  type Renderable,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { CursorText } from "./cursor-text";
import type { DiffView } from "./diff-view";
import { sessionHighlights } from "./highlight-service";
import { themes } from "./theme";
import { mountReview } from "./view";
import { selectedDocumentPart } from "./view-test-utils";

function narratives(root: Renderable): CursorText[] {
  return [
    ...(root instanceof CursorText ? [root] : []),
    ...root.getChildren().flatMap(narratives),
  ];
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: scroll carries the cursor and clicks focus narrative and source sides`, async () => {
      const snapshot = structuredClone(fixture) as ReviewSnapshot;
      snapshot.sections[0].explanation = Array.from(
        { length: 70 },
        (_, index) => `Narrative ${index + 1}`,
      ).join("\n");
      snapshot.sections[1].title = "Farewell 日本語 👋 ".repeat(20);
      const ui = await createTestRenderer({ width: 140, height: 28 });

      try {
        const applyTheme = mountReview(
          ui.renderer,
          { snapshot, analysis: analyzeDiffs(snapshot) },
          theme,
          mode,
        );
        await sessionHighlights(ui.renderer).settled();
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        const selected = () =>
          narratives(body).find((node) => node.selectedText)?.selectedText;

        await press("\u000e");
        const title = narratives(body).find(
          (node) => node.plainText === "Greeting",
        );
        expect(
          (title?.content.chunks[0]?.attributes ?? 0) & TextAttributes.BOLD,
        ).toBeTruthy();
        await press("\u0004");
        const halfPage = body.scrollTop;
        expect(selected()).toMatch(/^Narrative /);
        await press("j");
        expect(body.scrollTop).toBeGreaterThanOrEqual(halfPage);
        expect(body.scrollTop - halfPage).toBeLessThan(2);
        await press("\u0015");
        expect(body.scrollTop).toBeLessThan(halfPage);
        await press("\u001b[6~");
        expect(selected()).toMatch(/^Narrative /);
        const pageDown = body.scrollTop;
        await press("k");
        expect(Math.abs(body.scrollTop - pageDown)).toBeLessThanOrEqual(1);
        await press("\u001b[5~");
        expect(body.scrollTop).toBeLessThan(pageDown);

        const node = narratives(body).find((node) =>
          node.plainText.startsWith("Narrative 1\n"),
        );
        expect(node).toBeDefined();
        const visibleLine = node?.cursorLines().find((line) => {
          const bounds = node.lineBounds(line);
          return (
            bounds.top > body.viewport.y &&
            bounds.bottom < body.viewport.y + body.viewport.height
          );
        });
        expect(visibleLine).toBeDefined();
        if (!node || visibleLine === undefined)
          throw new Error("Missing narrative line");
        await ui.mockMouse.click(
          body.viewport.x + 2,
          node.lineBounds(visibleLine).top,
        );
        await ui.renderOnce();
        expect(selected()).toBe(`Narrative ${visibleLine + 1}`);
        await press("j");
        expect(selected()).toBe(`Narrative ${visibleLine + 2}`);

        const beforeWheel = selected();
        await ui.mockMouse.scroll(
          body.viewport.x + 2,
          body.viewport.y + 3,
          "down",
        );
        await ui.renderOnce();
        expect(selected()).not.toBe(beforeWheel);
        const wheelTop = body.scrollTop;
        await press("j");
        expect(body.scrollTop).toBe(wheelTop);
        const beforeArrow = selected();
        await press("\u001b[B");
        expect(selected()).not.toBe(beforeArrow);
        await press("\u001b[A");
        expect(selected()).toBe(beforeArrow);

        await press("\t");
        const diff = ui.renderer.root.findDescendantById(
          "changes-1",
        ) as DiffView;
        const source = diff
          .cursorTargets()
          .find((target) => !target.selected && target.top >= body.viewport.y);
        expect(source).toBeDefined();
        if (!source) throw new Error("Missing source row");
        await ui.mockMouse.click(body.viewport.x + 2, source.top);
        await ui.renderOnce();
        expect(diff.hasCursor).toBe(true);
        await press("c");
        expect(ui.captureCharFrame()).toContain("old line 1");
        expect(
          ui.renderer.root.findDescendantById("comment-editor"),
        ).toBeDefined();
        await press("\u001b[27u");
        if (mode === "side-by-side") {
          await ui.mockMouse.click(
            body.viewport.x + body.viewport.width - 3,
            source.top,
          );
          await ui.renderOnce();
          await press("c");
          expect(ui.captureCharFrame()).toContain("new line 1");
          await press("\u001b[27u");
        }

        applyTheme(
          themes[theme.name === "github-dark" ? "github-light" : "github-dark"],
        );
        ui.resize(85, 20);
        await ui.renderOnce();
        await press("\u000e");
        expect(selectedDocumentPart(ui.renderer)).toBe(2);
        await ui.mockMouse.click(body.viewport.x + 2, body.viewport.y + 1);
        await ui.renderOnce();
        expect(selectedDocumentPart(ui.renderer)).toBe(2);
        await press("\u001b[5~");
        expect(selectedDocumentPart(ui.renderer)).toBe(1);
        const previousPage = body.scrollTop;
        await press("j");
        expect(Math.abs(body.scrollTop - previousPage)).toBeLessThanOrEqual(1);
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}
