import { expect, test } from "bun:test";
import { RGBA, ScrollBoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { DiffView } from "./diff-view";
import { MarkdownView } from "./markdown-view";
import type { FileRows } from "./diff";
import type { SyntaxService } from "./highlight-service";
import { readableTokenColor, type SourceColors } from "./highlight";
import { themes } from "./theme";

class DelayedSyntax implements SyntaxService {
  requests: { source: string; signal?: AbortSignal; finish: () => void }[] = [];

  highlight(
    source: string,
    _language: string | undefined,
    signal?: AbortSignal,
  ) {
    return new Promise<SourceColors>((resolve) => {
      this.requests.push({
        source,
        signal,
        finish: () => {
          const lines = source
            .split("\n")
            .map((text) => [{ text, color: "#123456" }]);
          resolve({ "github-light": lines, "github-dark": lines });
        },
      });
    });
  }

  async finish() {
    for (const request of this.requests) request.finish();

    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function file(source: string): FileRows {
  return {
    id: "code",
    newPath: "code.ts",
    oldPath: null,
    width: 3,
    rows: Array.from({ length: 40 }, (_, index) => ({
      text: `+${source}`,
      role: "addition" as const,
      line: {
        kind: "addition" as const,
        raw: `+${source}\n`,
        oldLine: null,
        newLine: index + 1,
      },
    })),
  };
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: delayed diff colors preserve live layout, scroll and collapse state`, async () => {
      const ui = await createTestRenderer({ width: 120, height: 15 });
      const syntax = new DelayedSyntax();
      const body = new ScrollBoxRenderable(ui.renderer, {
        width: "100%",
        height: "100%",
      });
      ui.renderer.root.add(body);
      const view = new DiffView(ui.renderer, body, theme, syntax);
      body.add(view);

      try {
        view.setFiles([file("const current = 42;")], mode);
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toContain("+const current = 42;");
        expect(syntax.requests.length).toBeGreaterThan(0);

        const next =
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ];
        view.setTheme(next);
        view.setMode(mode === "inline" ? "side-by-side" : "inline");
        ui.resize(65, 15);
        view.resizeLayout();
        await ui.renderOnce();
        body.scrollBy(6);
        await ui.renderOnce();
        expect(body.scrollTop).toBeGreaterThan(0);
        const before = ui.captureCharFrame();
        const top = body.scrollTop;
        await syntax.finish();
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toBe(before);
        expect(body.scrollTop).toBe(top);
        const color = RGBA.fromHex(
          readableTokenColor(
            "#123456",
            next.diff.addition.foreground,
            next.diff.addition.background,
          ),
        );
        expect(
          ui
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .some(
              (span) => span.text.includes("current") && span.fg.equals(color),
            ),
        ).toBe(true);

        view.setFiles([file("const replacement = 1;")], mode);
        await ui.renderOnce();
        view.toggleVisibleFile();
        await ui.renderOnce();
        const collapsed = ui.captureCharFrame();
        await syntax.finish();
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toBe(collapsed);
        expect(collapsed).not.toContain("replacement");
      } finally {
        await ui.dispose();
      }
    });
  }
}

test("obsolete diff and Markdown responses cannot recolor replacement content or destroyed nodes", async () => {
  const ui = await createTestRenderer({ width: 90, height: 25 });
  const syntax = new DelayedSyntax();
  const body = new ScrollBoxRenderable(ui.renderer, {
    width: "100%",
    height: "100%",
  });
  ui.renderer.root.add(body);
  const diff = new DiffView(ui.renderer, body, themes["github-dark"], syntax);
  const markdown = new MarkdownView(ui.renderer, themes["github-dark"], syntax);
  body.add(markdown);
  body.add(diff);

  try {
    diff.setFiles([file("oldDiff")], "inline");
    markdown.setContent("```ts\noldFence\n```");
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("oldFence");
    expect(ui.captureCharFrame()).toContain("oldDiff");
    const obsolete = [...syntax.requests];
    diff.setFiles([file("newDiff")], "inline");
    markdown.setContent("```ts\nnewFence\n```");
    await ui.renderOnce();
    const plain = ui.captureCharFrame();
    for (const request of obsolete) {
      expect(request.signal?.aborted).toBe(true);
      request.finish();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toBe(plain);
    expect(plain).toContain("newDiff");
    expect(plain).toContain("newFence");
    markdown.setTheme(themes["github-light"]);
    await syntax.finish();
    await ui.renderOnce();

    const expected = RGBA.fromHex(
      readableTokenColor(
        "#123456",
        themes["github-light"].markdown.code,
        themes["github-light"].markdown.codeBackground,
      ),
    );
    expect(
      ui
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .some(
          (span) => span.text.includes("newFence") && span.fg.equals(expected),
        ),
    ).toBe(true);

    markdown.setContent("```py\ndestroyed\n```");
    markdown.destroyRecursively();
    diff.destroyRecursively();
    await syntax.finish();
    await ui.renderOnce();

    expect(ui.captureCharFrame()).not.toContain("destroyed");
  } finally {
    await ui.dispose();
  }
});
