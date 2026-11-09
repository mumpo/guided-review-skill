import { expect, test } from "bun:test";
import {
  RGBA,
  StyledText,
  type InputRenderable,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { mountReview } from "./view";
import { searchChunks, searchRanges, SearchText } from "./search";
import { themes } from "./theme";
import { sessionHighlights } from "./highlight-service";
import type { DiffView } from "./diff-view";

function data() {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  snapshot.pullRequest.description =
    "A **needle** and needle; NEEDLE. 🐱needle";
  snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];

  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

test("literal matching, explicit case folding, Unicode and chunk boundaries", () => {
  expect(searchRanges("a.* aZZ", ".*")).toEqual([{ start: 1, end: 3 }]);
  expect(searchRanges("Needle needle NEEDLE", "needle")).toEqual([
    { start: 7, end: 13 },
  ]);
  expect(searchRanges("Needle needle NEEDLE", "nee\\cdle")).toHaveLength(3);
  expect(searchRanges("🐱İIıi needle", "\\ci")).toEqual([
    { start: 3, end: 4 },
    { start: 5, end: 6 },
  ]);
  expect(searchRanges("aaa", "aa")).toEqual([{ start: 0, end: 2 }]);
  expect(searchRanges("abc", "\\c")).toEqual([]);
  const chunks = searchChunks(
    [
      { __isChunk: true, text: "nee", attributes: 1 },
      { __isChunk: true, text: "dle!", link: { url: "https://example.com" } },
    ],
    [{ start: 1, end: 5 }],
    0,
    themes["github-dark"].search,
  );

  expect(chunks.map((chunk) => chunk.text).join("")).toBe("needle!");
  expect(chunks.map((chunk) => chunk.text)).toEqual(["n", "ee", "dl", "e!"]);
  expect(
    chunks[1].bg?.equals(
      RGBA.fromHex(themes["github-dark"].search.focused.background),
    ),
  ).toBe(true);
  expect(chunks[1].attributes).toBe(1);
  expect(chunks[2].link?.url).toBe("https://example.com");
});

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: live document search, commit, navigation, folding, and Escape priority`, async () => {
      const ui = await createTestRenderer({ width: 140, height: 30 });
      try {
        const applyTheme = mountReview(ui.renderer, data(), theme, mode);
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();
        const get = <T>(id: string) =>
          ui.renderer.root.findDescendantById(id) as T;
        const body = get<ScrollBoxRenderable>("body");
        const count = get<TextRenderable>("search-count");
        const input = get<InputRenderable>("search-input");
        const changes = get<DiffView>("changes-1");
        const press = async (...keys: string[]) => {
          await ui.mockInput.pressKeys(keys);
          await ui.renderOnce();
        };
        const query = async (text: string) => {
          await press("/");
          await ui.mockInput.typeText(text);
          await ui.renderOnce();
        };
        expect(get("heading")).toBeUndefined();
        expect(body.y).toBe(0);
        await query("needle");
        expect(body.y).toBe(2);
        expect(input.value).toBe("needle");
        expect(count.plainText).toBe(" 0/3 ");
        expect(body.scrollTop).toBe(0);
        expect(get<TextRenderable>("search-separator").y).toBe(1);
        expect(
          ui
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .some((span) =>
              span.bg.equals(RGBA.fromHex(theme.search.match.background)),
            ),
        ).toBe(true);
        await press("\r");
        expect(input.focused).toBe(false);
        expect(count.plainText).toBe(" 1/3 ");
        await press("n", "n");
        expect(count.plainText).toBe(" 3/3 ");
        await press("n");
        expect(count.plainText).toBe(" 1/3 ");
        await press("N");
        expect(count.plainText).toBe(" 3/3 ");
        await query("\\cneedle");
        expect(count.plainText).toBe(" 0/4 ");
        await press("\u001b[27u");
        expect(body.y).toBe(0);
        expect(input.focused).toBe(false);

        await press("\u000e", "\t", "z");
        expect(ui.captureCharFrame()).not.toContain("+hello world");
        await query("world");
        expect(count.plainText).toBe(" 0/1 ");
        await press("\r");
        expect(count.plainText).toBe(" 1/1 ");
        expect(changes.hasCursor).toBe(true);
        expect(ui.captureCharFrame()).toContain("+hello world");
        await press("c");
        expect(get("comment-editor")).toBeDefined();
        await ui.mockInput.typeText("draft /nN");
        await press("\u001b[27u");
        expect(get("comment-editor")).toBeUndefined();
        expect(count.plainText).toBe(" 1/1 ");
        applyTheme(
          themes[theme.name === "github-dark" ? "github-light" : "github-dark"],
        );
        await press("d");
        ui.resize(65, 18);
        await ui.renderOnce();
        expect(count.plainText).toBe(" 1/1 ");
        await press("\u001b[27u");
        expect(body.y).toBe(0);
        expect(changes.hasCursor).toBe(true);
        await press("c");
        expect(get<InputRenderable>("comment-editor").plainText).toBe(
          "draft /nN",
        );
        await press("\u001b[27u");
        await query("absent");
        expect(count.plainText).toBe(" No matches ");
        await press("\r", "n", "N");
        expect(count.plainText).toBe(" No matches ");
        await query("\\c");
        await press("\r");
        expect(body.y).toBe(0);
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("SearchText retains overlays across base style changes and restores original chunks", async () => {
  const ui = await createTestRenderer({ width: 40, height: 6 });
  try {
    const node = new SearchText(ui.renderer, { content: "needle", width: 30 });
    ui.renderer.root.add(node);
    node.setSearch([{ start: 0, end: 6 }], 0, themes["github-dark"].search);
    node.content = new StyledText([
      { __isChunk: true, text: "needle", fg: RGBA.fromHex("#ff0000") },
    ]);
    await ui.renderOnce();
    expect(
      ui
        .captureSpans()
        .lines[0].spans.find((span) => span.text.includes("needle"))
        ?.bg.equals(
          RGBA.fromHex(themes["github-dark"].search.focused.background),
        ),
    ).toBe(true);
    node.setSearch([], undefined, themes["github-dark"].search);
    await ui.renderOnce();
    expect(
      ui
        .captureSpans()
        .lines[0].spans.find((span) => span.text.includes("needle"))
        ?.fg.equals(RGBA.fromHex("#ff0000")),
    ).toBe(true);
  } finally {
    await ui.dispose();
  }
});

for (const mode of ["inline", "side-by-side"] as const) {
  test(`${mode}: context is counted once, metadata/notices/comments are searchable, and hidden source stays excluded`, async () => {
    const review = data();
    review.snapshot.summary = "HIDDEN_SUMMARY";
    review.snapshot.sections[0].explanation +=
      "\n```mermaid\nflowchart TD\nMERMAID_LABEL --> B\n```";
    review.snapshot.files[1].diff = {
      kind: "text",
      unified: "@@ -1 +1,2 @@\n-Old guide\n+New guide\n+UNSELECTED_SOURCE\n",
    };
    review.snapshot.sections[0].references = [
      { kind: "file", fileId: "greeting" },
      { kind: "lines", fileId: "guide", side: "new", startLine: 1, endLine: 1 },
    ];
    review.snapshot.sections[1].references = [];
    review.analysis = analyzeDiffs(review.snapshot);
    const ui = await createTestRenderer({ width: 140, height: 34 });
    try {
      mountReview(
        ui.renderer,
        review,
        undefined,
        mode,
        async (_target, body) => ({
          id: 10,
          body,
          author: "commentAuthor",
          url: "https://example.com/commentURL",
        }),
      );
      await sessionHighlights(ui.renderer).settled();
      await ui.renderOnce();
      const get = <T>(id: string) =>
        ui.renderer.root.findDescendantById(id) as T;
      const press = async (...keys: string[]) => {
        await ui.mockInput.pressKeys(keys);
        await ui.renderOnce();
      };
      const query = async (value: string) => {
        await press("/");
        await ui.mockInput.pasteBracketedText(value);
        await ui.renderOnce();
      };
      const count = get<TextRenderable>("search-count");
      await query("unchanged");
      expect(count.plainText).toBe(" 0/1 ");
      await press("\r");
      const matches = ui
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .filter(
          (span) =>
            span.text.includes("unchanged") &&
            span.bg.equals(
              RGBA.fromHex(themes["github-dark"].search.focused.background),
            ),
        );
      expect(matches).toHaveLength(mode === "inline" ? 1 : 2);
      await query("hello world");
      await press("\r", "c");
      await ui.mockInput.typeText("publishedNeedle");
      await press("\u0013");
      await ui.waitFor(() => !get("comment-editor"));
      await query("publishedNeedle");
      expect(count.plainText).toBe(" 0/1 ");
      await press("\r");
      expect(count.plainText).toBe(" 1/1 ");
      expect(get<DiffView>("changes-1").hasCursor).toBe(true);
      await press("c");
      expect(get("comment-editor")).toBeUndefined();
      for (const term of [
        "commentAuthor",
        "commentURL",
        "MERMAID_LABEL",
        "0123456789abcdef0123456789abcdef01234567",
        "reviewer",
        "Binary file:",
        "unreferenced lines omitted",
      ]) {
        await query(term);
        expect(count.plainText).not.toBe(" No matches ");
        await press("\r");
        expect(count.plainText).toMatch(/ [1-9]\d*\/[1-9]\d* /);
      }
      for (const term of ["UNSELECTED_SOURCE", "HIDDEN_SUMMARY"]) {
        await query(term);
        expect(count.plainText).toBe(" No matches ");
      }
    } finally {
      await sessionHighlights(ui.renderer).settled();
      await ui.dispose();
    }
  });
}

test("wrapped offscreen matches reveal their continuation and preserve search through resizing", async () => {
  const review = data();
  review.snapshot.pullRequest.description = `${"👩‍💻 中文 words ".repeat(60)}NARRATIVE_MIDDLE ${"👩‍💻 中文 words ".repeat(60)}NARRATIVE_END`;
  review.snapshot.files[0].diff = {
    kind: "text",
    unified: `@@ -0,0 +1 @@\n+${"界x".repeat(400)}SOURCE_END\n`,
  };
  review.snapshot.sections[0].references = [
    { kind: "file", fileId: "greeting" },
  ];
  review.snapshot.sections[1].references = [];
  review.analysis = analyzeDiffs(review.snapshot);
  const ui = await createTestRenderer({ width: 50, height: 16 });
  try {
    mountReview(ui.renderer, review);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();
    const press = async (...keys: string[]) => {
      await ui.mockInput.pressKeys(keys);
      await ui.renderOnce();
    };
    for (const term of ["NARRATIVE_MIDDLE", "NARRATIVE_END", "SOURCE_END"]) {
      await press("/");
      const body = ui.renderer.root.findDescendantById(
        "body",
      ) as ScrollBoxRenderable;
      const top = body.scrollTop;
      await ui.mockInput.typeText(term);
      await ui.renderOnce();
      expect(body.scrollTop).toBe(top);
      await press("\r");
      expect(ui.captureCharFrame()).toContain(term);
      expect(body.scrollTop).toBeGreaterThan(top);
      ui.resize(38, 16);
      await ui.renderOnce();
      await press("n");
      expect(ui.captureCharFrame()).toContain(term);
      await press("\u001b[27u");
      expect(body.y).toBe(0);
    }
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

for (const mode of ["inline", "side-by-side"] as const) {
  test(`${mode}: results follow captured source order and retain exact comment targets after rebuilds`, async () => {
    const review = data();
    review.snapshot.files[0].diff = {
      kind: "text",
      unified:
        "@@ -1,2 +1,2 @@\n-MATCH old1\n-MATCH old2\n+MATCH new1\n+MATCH new2\n\\ No newline at end of file\n",
    };
    review.snapshot.sections[1].references = [];
    review.analysis = analyzeDiffs(review.snapshot);
    const calls: { side: string; line: number }[] = [];
    const ui = await createTestRenderer({ width: 140, height: 32 });
    try {
      mountReview(
        ui.renderer,
        review,
        undefined,
        mode,
        async (target, body) => {
          calls.push({ side: target.side, line: target.line });
          return {
            id: calls.length,
            body,
            author: "me",
            url: "https://example.com",
          };
        },
      );
      await sessionHighlights(ui.renderer).settled();
      const press = async (...keys: string[]) => {
        await ui.mockInput.pressKeys(keys);
        await ui.renderOnce();
      };
      await press("\u000e", "/");
      await ui.mockInput.typeText("MATCH");
      await press("\r");
      for (let index = 0; index < 4; index++) {
        await press("c");
        await ui.mockInput.typeText("posted");
        await press("\u0013");
        await ui.waitFor(
          () => !ui.renderer.root.findDescendantById("comment-editor"),
        );
        if (index < 3) await press("n");
      }
      expect(calls).toEqual([
        { side: "old", line: 1 },
        { side: "old", line: 2 },
        { side: "new", line: 1 },
        { side: "new", line: 2 },
      ]);
      await press("/");
      await ui.mockInput.typeText("No newline");
      await press("\r");
      const count = ui.renderer.root.findDescendantById(
        "search-count",
      ) as TextRenderable;
      expect(count.plainText).toBe(" 1/1 ");
      expect(ui.captureCharFrame()).toContain("No newline at end of file");
      await press("c");
      expect(
        ui.renderer.root.findDescendantById("comment-editor"),
      ).toBeUndefined();
    } finally {
      await sessionHighlights(ui.renderer).settled();
      await ui.dispose();
    }
  });
}
