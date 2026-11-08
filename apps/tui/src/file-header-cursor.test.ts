import { expect, test } from "bun:test";
import {
  type BoxRenderable,
  RGBA,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { cursorBackground } from "./cursor-highlight";
import { sessionHighlights } from "./highlight-service";
import { themes } from "./theme";
import { mountFullWidthReview as mountReview } from "./view-test-utils";

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: cursor visits folded headers and z toggles the selected file`, async () => {
      const snapshot = structuredClone(fixture) as ReviewSnapshot;
      snapshot.sections[0].explanation = "Inspect these files.";
      snapshot.sections[0].references = snapshot.files.map((file) => ({
        kind: "file",
        fileId: file.id,
      }));
      const ui = await createTestRenderer({ width: 120, height: 40 });

      try {
        let currentTheme = theme;
        const applyTheme = mountReview(
          ui.renderer,
          { snapshot, analysis: analyzeDiffs(snapshot) },
          theme,
          mode,
        );
        const body = ui.renderer.root.findDescendantById(
          "body",
        ) as ScrollBoxRenderable;
        const header = (id: string) =>
          ui.renderer.root.findDescendantById(
            `file-header-${id}`,
          ) as BoxRenderable;
        const content = (id: string) => {
          const box = header(id);
          const children = box.parent?.getChildren() ?? [];

          return children[children.indexOf(box) + 1];
        };
        const selected = (id: string) => {
          const box = header(id);
          expect(
            box.backgroundColor.equals(
              RGBA.fromHex(
                cursorBackground(currentTheme.surface, currentTheme.name),
              ),
            ),
          ).toBe(true);
          expect(box.width).toBe(body.viewport.width);
          expect(box.y).toBeGreaterThanOrEqual(body.viewport.y);
          expect(box.y + box.height).toBeLessThanOrEqual(
            body.viewport.y + body.viewport.height,
          );
        };
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        await press("\u000e", "j", "j", "c", " ");
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();

        selected("greeting");
        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(false);
        const originalHeight = header("greeting").height;
        await press("j", "z");

        selected("greeting");
        expect(content("greeting").visible).toBe(false);
        expect(header("greeting").height).toBe(originalHeight);
        await press("z");

        selected("greeting");
        expect(content("greeting").visible).toBe(true);
        await press("z", "j");

        selected("guide");
        expect(content("greeting").visible).toBe(false);
        expect(content("guide").visible).toBe(true);
        await press("z");

        selected("guide");
        expect(content("guide").visible).toBe(false);
        await press("d", "d");
        ui.resize(55, 24);
        currentTheme =
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ];
        applyTheme(currentTheme);
        await ui.renderOnce();

        selected("guide");
        expect(content("guide").visible).toBe(false);
        await press("z", "j", "c");

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(true);
        await press("\u001b[27u", "z", "j", "c", " ");

        selected("image");
        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(false);
        await press("z", "j", "z");

        selected("large");
        expect(content("large").visible).toBe(false);
        await press("k");

        selected("image");
        expect(content("image").visible).toBe(false);
        await press("k", "k", "k");

        expect(
          header("greeting").backgroundColor.equals(
            RGBA.fromHex(currentTheme.surface),
          ),
        ).toBe(true);
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}
