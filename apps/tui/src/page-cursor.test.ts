import { cursorBackground } from "./cursor-highlight";
import { expect, test } from "bun:test";
import {
  BoxRenderable,
  RGBA,
  type Renderable,
  ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { CursorText } from "./cursor-text";
import { mountFullWidthReview as mountReview } from "./view-test-utils";
import { sessionHighlights } from "./highlight-service";
import { themes } from "./theme";
import { PageCursor } from "./page-cursor";
import { DiffView } from "./diff-view";

function review(explanation: string) {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  snapshot.sections[0].explanation = explanation;

  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

function cursorText(root: Renderable): string {
  const selected: string[] = [];
  const walk = (node: Renderable) => {
    if (node instanceof CursorText) {
      selected.push(node.selectedText);
    }
    for (const child of node.getChildren()) walk(child);
  };

  walk(root);

  return selected.join("");
}

function cursorHighlightRows(
  ui: Awaited<ReturnType<typeof createTestRenderer>>,
  theme = themes["github-dark"],
) {
  const backgrounds = [
    theme.background,
    theme.markdown.codeBackground,
    theme.diff.addition.background,
    theme.diff.deletion.background,
  ].map((base) => RGBA.fromHex(cursorBackground(base, theme.name)));
  return ui
    .captureSpans()
    .lines.filter((line) =>
      line.spans.some((span) =>
        backgrounds.some((background) => span.bg.equals(background)),
      ),
    );
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: one cursor crosses Markdown, lists, code and files in both directions`, async () => {
      const data = review(
        "# Heading\n\nFirst **bold** line.\nSecond line.\n\n- Item one\n- Item two\n\n```ts\nconst alpha = 1;\nconst beta = 2;\n```",
      );
      const ui = await createTestRenderer({ width: 120, height: 45 });

      try {
        const applyTheme = mountReview(
          ui.renderer,
          data,
          theme,
          mode,
          async () => {
            throw new Error("Must not publish Markdown");
          },
        );
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        await press("\u000e");
        await sessionHighlights(ui.renderer).settled();

        expect(cursorText(ui.renderer.root)).toBe("Greeting");
        expect(ui.captureCharFrame()).not.toContain("▸");
        await press("k", "c", " ");

        expect(cursorText(ui.renderer.root)).toBe(
          data.snapshot.pullRequest.description,
        );
        await press("\u000e");
        expect(cursorText(ui.renderer.root)).toBe("Greeting");
        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(false);

        for (const text of [
          "Heading",
          "First bold line.",
          "Second line.",
          "Item one",
          "Item two",
          "const alpha = 1;",
          "const beta = 2;",
        ]) {
          await press("j");

          expect(cursorText(ui.renderer.root)).toBe(text);
          expect(ui.captureCharFrame()).not.toContain("▸");
          const bold = ui
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((span) => span.text === "bold");
          if (text === "First bold line.") {
            expect((bold?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
            expect((bold?.attributes ?? 0) & TextAttributes.UNDERLINE).toBe(0);
          } else if (text === "Second line.") {
            expect((bold?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
            expect((bold?.attributes ?? 0) & TextAttributes.UNDERLINE).toBe(0);
          }
        }

        const keyword = ui
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text === "const");
        expect(keyword).toBeDefined();
        expect(keyword?.fg.equals(RGBA.fromHex(theme.markdown.code))).toBe(
          false,
        );

        applyTheme(
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ],
        );
        await ui.renderOnce();

        expect(cursorText(ui.renderer.root)).toBe("const beta = 2;");
        await press("j");

        expect(cursorText(ui.renderer.root)).toBe("");
        expect(
          cursorHighlightRows(
            ui,
            themes[
              theme.name === "github-light" ? "github-dark" : "github-light"
            ],
          ).length,
        ).toBeGreaterThan(0);
        await press("c", " ");

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(false);
        await press("j", "c");

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(true);
        await press("\u001b[27u", "k", "k");

        expect(cursorText(ui.renderer.root)).toBe("const beta = 2;");
        expect(ui.captureCharFrame()).not.toContain("▸");
        await press("c", " ");

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(false);
        await press("k", "k", "k", "k", "k", "k", "k");

        expect(cursorText(ui.renderer.root)).toBe("Greeting");
        await press("\u000e", "\u0010");

        expect(cursorText(ui.renderer.root)).toBe("Greeting");
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("wrapped Unicode Markdown keeps its logical line selected and scrolls incrementally into the diff", async () => {
  const text =
    "Wrapped 👩‍💻 **bold** words with `inline()` and a [link](https://example.org). ".repeat(
      3,
    );
  const data = review(
    [
      text,
      ...Array.from({ length: 25 }, (_, index) => `Narrative ${index + 1}`),
    ].join("\n"),
  );
  const ui = await createTestRenderer({ width: 60, height: 20 });

  try {
    const applyTheme = mountReview(ui.renderer, data);
    await ui.mockInput.pressKeys(["\u000e", "j"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    const body = ui.renderer.root.findDescendantById(
      "body",
    ) as ScrollBoxRenderable;
    const selected = cursorText(ui.renderer.root);
    expect(selected).toContain("Wrapped 👩‍💻 bold words");
    expect(selected).not.toContain("Narrative");
    expect(body.scrollTop).toBeGreaterThan(0);
    const wrappedRows = cursorHighlightRows(ui);
    expect(wrappedRows.length).toBeGreaterThan(2);

    await ui.mockInput.pressKeys(["j", "j", "j"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Narrative 3");
    ui.resize(40, 20);
    applyTheme(themes["github-light"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Narrative 3");
    await ui.mockInput.pressKeys(Array(23).fill("j"));
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("");
    expect(
      cursorHighlightRows(ui, themes["github-light"]).length,
    ).toBeGreaterThan(0);
    expect(body.scrollTop).toBeGreaterThan(20);
    await ui.mockInput.pressKeys(["k"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Narrative 25");
    await ui.mockInput.pressKeys(["j", "\u000e"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Farewell");
    const secondSectionOffset = body.scrollTop;
    expect(secondSectionOffset).toBeGreaterThan(0);
    await ui.mockInput.pressKeys(["\u0010"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Greeting");
    expect(body.scrollTop).toBeLessThan(secondSectionOffset);
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("summary Markdown uses the same cursor and cannot open a source comment", async () => {
  const data = review("Explanation");
  data.snapshot.pullRequest.description =
    "Description first\nDescription second";
  const ui = await createTestRenderer({ width: 120, height: 40 });

  try {
    mountReview(ui.renderer, data);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    for (
      let index = 0;
      index < 20 && cursorText(ui.renderer.root) !== "Description first";
      index++
    ) {
      await ui.mockInput.pressKeys(["j"]);
      await ui.renderOnce();
    }

    expect(cursorText(ui.renderer.root)).toBe("Description first");
    await ui.mockInput.pressKeys(["j", "c", " "]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Description second");
    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
    await ui.mockInput.pressKeys(["k"]);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Description first");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("collapsing files leaves a narrative cursor in place and folded headers stay navigable", async () => {
  const data = review("Last narrative line");
  data.snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];
  data.analysis = analyzeDiffs(data.snapshot);
  const ui = await createTestRenderer({ width: 120, height: 38 });

  try {
    mountReview(ui.renderer, data);
    await sessionHighlights(ui.renderer).settled();
    const press = async (...keys: string[]) => {
      await ui.mockInput.pressKeys(keys);
      await ui.renderOnce();
      await ui.renderOnce();
    };
    await press("\u000e", "j", "z", "c");

    const body = ui.renderer.root.findDescendantById(
      "body",
    ) as ScrollBoxRenderable;
    expect(cursorText(ui.renderer.root)).toBe("Last narrative line");
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
    await press("j", "z", "j");

    expect(cursorText(ui.renderer.root)).toBe("");
    expect(cursorHighlightRows(ui).length).toBeGreaterThan(0);
    await press("z");

    expect(cursorText(ui.renderer.root)).toBe("");
    await press("c");

    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
    await press("k");

    expect(cursorText(ui.renderer.root)).toBe("Last narrative line");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("replacing selected diagram fallback text with an image-sized block selects surviving narrative", async () => {
  const ui = await createTestRenderer({ width: 70, height: 24 });
  const body = new ScrollBoxRenderable(ui.renderer, {
    width: "100%",
    height: "100%",
    contentOptions: { flexDirection: "column" },
  });
  const narrative = new BoxRenderable(ui.renderer, {
    width: "100%",
    flexDirection: "column",
  });
  const diagram = new BoxRenderable(ui.renderer, {
    width: "100%",
    flexDirection: "column",
  });
  const fallback = new CursorText(ui.renderer, {
    content: "```mermaid\nA --> B\n```",
    width: "100%",
  });
  const after = new CursorText(ui.renderer, {
    content: "After diagram",
    width: "100%",
  });
  const changes = new DiffView(ui.renderer, body, themes["github-dark"]);
  const cursor = new PageCursor(body, [narrative], changes);
  ui.renderer.root.add(body);
  body.add(narrative);
  body.add(changes);
  narrative.add(diagram);
  diagram.add(fallback);
  narrative.add(after);

  try {
    cursor.reset();
    cursor.move(1);
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("A --> B");
    fallback.destroyRecursively();
    diagram.add(new BoxRenderable(ui.renderer, { width: 30, height: 4 }));
    cursor.refresh();
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("After diagram");
    cursor.move(-1);

    expect(cursorText(ui.renderer.root)).toBe("After diagram");
    after.destroyRecursively();
    cursor.refresh();
    diagram.add(
      new CursorText(ui.renderer, {
        content: "Restored source fallback",
        width: "100%",
      }),
    );
    cursor.refresh();
    await ui.renderOnce();

    expect(cursorText(ui.renderer.root)).toBe("Restored source fallback");
  } finally {
    await ui.dispose();
  }
});
