import { expect, test } from "bun:test";
import {
  RGBA,
  ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";
import {
  createTestRenderer,
  setRendererCapabilities,
} from "@opentui/core/testing";
import { MarkdownView } from "./markdown-view";
import { ExplanationView } from "./explanation-view";
import { highlightSource, languageForFence } from "./highlight";
import { themes } from "./theme";
import { loadReview } from "./load";
import { mountReview } from "./view";

for (const theme of Object.values(themes)) {
  test(`${theme.name}: Markdown paints headings, nested emphasis, code and passive visible links`, async () => {
    const ui = await createTestRenderer({ width: 100, height: 32 });

    try {
      setRendererCapabilities(ui.renderer, { hyperlinks: true });

      const view = new MarkdownView(ui.renderer, theme);

      ui.renderer.root.add(view);
      view.setContent(
        [
          "# Heading",
          "",
          "Paragraph **bold *both*** and `inline()`.",
          "",
          "3. first",
          "   - nested",
          "4. second",
          "",
          "[docs][ref] and <https://example.org>",
          "",
          "```ts",
          'const answer: string = "hello";',
          "  // whitespace 👩‍💻",
          "```",
          "",
          '[ref]: https://example.com/docs "Documentation"',
        ].join("\n"),
      );
      await ui.renderOnce();

      const frame = ui.captureCharFrame();

      expect(frame).toContain("Heading");
      expect(frame).not.toContain("# Heading");
      expect(frame).toContain("Paragraph bold both and inline().");
      expect(frame).toContain("3. first");
      expect(frame).toContain("   • nested");
      expect(frame).toContain(
        'docs (https://example.com/docs) "Documentation"',
      );
      expect(frame).toContain("  // whitespace 👩‍💻");

      const spans = ui.captureSpans().lines.flatMap((line) => line.spans);
      const heading = spans.find((span) => span.text.includes("Heading"));

      expect(heading?.fg.equals(RGBA.fromHex(theme.markdown.heading))).toBe(
        true,
      );
      expect((heading?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();

      const both = spans.find((span) => span.text.includes("both"));

      expect((both?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
      expect((both?.attributes ?? 0) & TextAttributes.ITALIC).toBeTruthy();

      const code = spans.find((span) => span.text.includes("inline()"));

      expect(code?.bg.equals(RGBA.fromHex(theme.markdown.codeBackground))).toBe(
        true,
      );

      const link = spans.find((span) => span.text.includes("docs (https"));

      expect(link?.fg.equals(RGBA.fromHex(theme.markdown.link))).toBe(true);

      const keyword = spans.find((span) => span.text === "const");

      expect(keyword).toBeDefined();
      expect(
        keyword?.bg.equals(RGBA.fromHex(theme.markdown.codeBackground)),
      ).toBe(true);
      expect(keyword?.fg.equals(RGBA.fromHex(theme.markdown.code))).toBe(false);

      // Rendered chunks never contain terminal hyperlink metadata.
      const walk = (
        node:
          | MarkdownView
          | TextRenderable
          | import("@opentui/core").Renderable,
      ): void => {
        if (node instanceof TextRenderable && typeof node.content !== "string")
          expect(node.content.chunks.every((chunk) => !chunk.link)).toBe(true);

        for (const child of node.getChildren()) walk(child);
      };

      walk(view);

      const destination =
        "https://example.com/abcdefghijklmnopqrstuvwxyz/0123456789";
      const source = '  const text = "👩‍💻 é";  ';

      view.setContent(
        `[long](${destination})\n\n~~~~typescript\n${source}\n~~~~`,
      );
      ui.resize(22, 32);
      await ui.renderOnce();

      // A destination longer than the viewport must remain complete after wrapping.
      const wrapped = ui
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trim())
        .join("");

      expect(wrapped).toContain(destination);

      const codeNode = view
        .getChildren()
        .find(
          (node) =>
            node instanceof TextRenderable &&
            typeof node.content !== "string" &&
            node.content.chunks.map((chunk) => chunk.text).join("") === source,
        );

      expect(codeNode).toBeDefined();
    } finally {
      await ui.dispose();
    }
  });

  test(`${theme.name}: unsupported constructs, unknown code and unclosed fences retain readable source`, async () => {
    const ui = await createTestRenderer({ width: 85, height: 38 });

    try {
      const view = new MarkdownView(ui.renderer, theme);

      ui.renderer.root.add(view);
      view.setContent(
        [
          '<script>alert("captured")</script>',
          "",
          "![alt](https://example.com/image.png)",
          "",
          "| A | B |",
          "| - | - |",
          "| x | y |",
          "",
          "> quoted **source**",
          "",
          "- [x] checked",
          "",
          "```unknown",
          "  exact plain code",
          "```",
          "",
          "```mermaid",
          "A-->B",
          "```",
          "",
          "```js",
          "unclosed()",
        ].join("\n"),
      );
      await ui.renderOnce();

      const frame = ui.captureCharFrame();

      for (const text of [
        '<script>alert("captured")</script>',
        "![alt](https://example.com/image.png)",
        "| A | B |",
        "> quoted **source**",
        "- [x] checked",
        "  exact plain code",
        "```mermaid",
        "A-->B",
        "```js",
        "unclosed()",
      ])
        expect(frame).toContain(text);

      const plain = ui
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("exact plain code"));

      expect(plain?.fg.equals(RGBA.fromHex(theme.markdown.code))).toBe(true);
      expect(
        plain?.bg.equals(RGBA.fromHex(theme.markdown.codeBackground)),
      ).toBe(true);
    } finally {
      await ui.dispose();
    }
  });

  test(`${theme.name}: narrow wrapping, scrolling, resizing and recoloring preserve content and scroll`, async () => {
    const ui = await createTestRenderer({ width: 28, height: 12 });

    try {
      const body = new ScrollBoxRenderable(ui.renderer, {
        width: "100%",
        height: "100%",
        scrollX: false,
        scrollY: true,
      });

      ui.renderer.root.add(body);

      const view = new MarkdownView(ui.renderer, theme);

      body.add(view);
      view.setContent(
        [
          "- Parent",
          "  - nested words that must wrap beneath their list marker",
          "",
          "[long](https://example.com/abcdefghijklmnopqrstuvwxyz/0123456789)",
          "",
          "```python",
          'message = "abcdefghijklmnopqrstuvwxyz0123456789"',
          "```",
          "",
          ...Array.from(
            { length: 30 },
            (_, i) => `Paragraph ${i}: **readable**\n`,
          ),
          "ENDMARKER",
        ].join("\n"),
      );
      await ui.renderOnce();

      expect(ui.captureCharFrame()).toContain("• Parent");
      expect(ui.captureCharFrame()).toContain("  • nested words");

      const seen: string[] = [];

      for (let i = 0; i < 20; i++) {
        seen.push(ui.captureCharFrame());
        body.scrollBy(5);
        await ui.renderOnce();
      }

      expect(seen.join("\n")).toContain("ENDMARKER");
      expect(seen.join("\n")).toContain(
        "abcdefghijklmnopqrstuvwxyz".slice(0, 15),
      );

      const before = ui.captureCharFrame();
      const top = body.scrollTop;

      view.setTheme(
        themes[theme.name === "github-light" ? "github-dark" : "github-light"],
      );
      await ui.renderOnce();

      expect(body.scrollTop).toBe(top);
      expect(ui.captureCharFrame()).toBe(before);

      ui.resize(45, 12);
      await ui.renderOnce();
      body.scrollTo(10000);
      await ui.renderOnce();

      expect(ui.captureCharFrame()).toContain("ENDMARKER");

      body.scrollTo(0);
      await ui.renderOnce();

      expect(ui.captureCharFrame()).toContain("• Parent");
    } finally {
      await ui.dispose();
    }
  });
}

test("fence aliases and validated highlighting share offline grammars and fall back on failure", () => {
  for (const [info, lang] of Object.entries({
    "TypeScript title=example": "typescript",
    javascript: "javascript",
    ts: "typescript",
    python: "python",
    py: "python",
    "c++": "cpp",
    bash: "shellscript",
    shell: "shellscript",
  }))
    expect(languageForFence(info)).toBe(lang);

  for (const info of ["", "not-a-language", "constructor", "__proto__"])
    expect(languageForFence(info)).toBeUndefined();

  expect(
    highlightSource("same", "typescript", () => {
      throw new Error("failure");
    }),
  ).toBeUndefined();
  expect(
    highlightSource("same", "typescript", () => [[{ text: "changed" }]]),
  ).toBeUndefined();
  expect(
    highlightSource("same", "typescript", () => [
      [{ text: "same", color: "invalid" }],
    ]),
  ).toBeUndefined();
});

test("Markdown around Mermaid keeps reference definitions and diagram fallbacks in narrative order", async () => {
  const ui = await createTestRenderer({ width: 85, height: 25 });

  try {
    const body = new ScrollBoxRenderable(ui.renderer, {
      width: "100%",
      height: "100%",
    });

    ui.renderer.root.add(body);

    const view = new ExplanationView(ui.renderer, body, themes["github-dark"]);

    body.add(view);
    view.setContent(
      "# Before\n\n[docs][ref]\n\n```mermaid\nA-->B\n```\n\n**Between**\n\n```mermaid\nB-->C\n```\n\nAfter\n\n[ref]: https://example.com",
    );
    await ui.renderOnce();

    const frame = ui.captureCharFrame();

    expect(frame).toContain("docs (https://example.com)");
    expect(frame).not.toContain("# Before");
    expect(frame).not.toContain("**Between**");
    expect(frame.indexOf("Before")).toBeLessThan(frame.indexOf("A-->B"));
    expect(frame.indexOf("A-->B")).toBeLessThan(frame.indexOf("Between"));
    expect(frame.indexOf("Between")).toBeLessThan(frame.indexOf("B-->C"));
    expect(frame.indexOf("B-->C")).toBeLessThan(frame.indexOf("After"));
  } finally {
    await ui.dispose();
  }
});

test("summary and description format independently while titles, metadata and navigation remain literal", async () => {
  const review = await loadReview(
    new URL("../../../packages/core/fixtures/valid.json", import.meta.url)
      .pathname,
  );
  review.snapshot.pullRequest.title = "**literal title**";
  review.snapshot.summary =
    "# Summary heading\n\n**formatted summary**\n\n[unresolved][desc]";
  review.snapshot.pullRequest.description =
    "*formatted description*\n\n[desc]: https://example.com\n\n```mermaid\nA-->B\n```";
  review.snapshot.sections[0].explanation =
    "## Explanation heading\n\n**formatted explanation**";

  const ui = await createTestRenderer({ width: 110, height: 65 });

  try {
    const applyTheme = mountReview(ui.renderer, review);

    await ui.renderOnce();

    let frame = ui.captureCharFrame();

    expect(frame).toContain("**literal title**");
    expect(frame).toContain("formatted summary");
    expect(frame).not.toContain("**formatted summary**");
    expect(frame).toContain("formatted description");
    expect(frame).not.toContain("*formatted description*");
    expect(frame).toContain("[unresolved][desc]");
    expect(frame).toContain("```mermaid");

    await ui.mockInput.pressKeys(["n"]);
    await ui.renderOnce();
    frame = ui.captureCharFrame();

    expect(frame).toContain("Explanation heading");
    expect(frame).not.toContain("## Explanation heading");
    expect(frame).toContain("formatted explanation");
    expect(frame).toContain("File: src/greeting.ts");

    applyTheme(themes["github-light"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toBe(frame);

    await ui.mockInput.pressKeys(["s"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("Summary heading");
  } finally {
    await ui.dispose();
  }
});
