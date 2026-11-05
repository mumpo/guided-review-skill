import { expect, test } from "bun:test";
import type { DiffLine } from "../../../packages/core/src";
import type { FileRows } from "./diff";
import {
  contrastRatio,
  highlightFile,
  languageForPath,
  readableTokenColor,
  type Tokenizer,
} from "./highlight";
import { themes } from "./theme";

function file(path: string, raw: string[]): FileRows {
  return {
    id: "code",
    oldPath: path,
    newPath: path,
    width: 3,
    rows: raw.map((text, index) => {
      const kind = text.startsWith("+")
        ? "addition"
        : text.startsWith("-")
          ? "deletion"
          : "context";

      return {
        text,
        role: kind,
        line: {
          raw: `${text}\n`,
          kind,
          oldLine: index + 1,
          newLine: index + 1,
        },
      };
    }),
  };
}

test("explicit path aliases include declaration files and leave unknown paths plain", () => {
  for (const [path, language] of Object.entries({
    "x.d.ts": "typescript",
    "x.mts": "typescript",
    "x.cjs": "javascript",
    "x.jsx": "jsx",
    "x.tsx": "tsx",
    "x.pyw": "python",
    "x.hpp": "cpp",
    "x.h": "c",
    "x.YML": "yaml",
    "x.htm": "html",
    "x.zsh": "shellscript",
  }))
    expect(languageForPath(path)).toBe(language);

  for (const path of [
    null,
    undefined,
    "Makefile",
    ".bashrc",
    "dir.with.dot/file",
    "x.unknown",
    "x.constructor",
  ])
    expect(languageForPath(path)).toBeUndefined();
});

test("every bundled language highlights offline with exact source preservation in both themes", () => {
  const examples = {
    js: 'const answer = "hello";',
    ts: 'const answer: string = "hello";',
    jsx: 'const el = <div title="hello" />;',
    tsx: 'const el = <div title="hello" />;',
    py: 'def hello(): return "hello"',
    go: 'package main; var hello = "hello"',
    rs: 'let hello = "hello";',
    java: 'class Hello { String value = "hello"; }',
    c: 'char *hello = "hello";',
    cpp: 'auto hello = "hello";',
    json: '{"hello": true}',
    yaml: "hello: true",
    html: '<div title="hello">text</div>',
    css: ".hello { color: red; }",
    sh: 'echo "hello"',
    sql: "SELECT 'hello' FROM world;",
    md: "**hello** `world`",
  };

  for (const [ext, source] of Object.entries(examples)) {
    const input = file(`code.${ext}`, [
      `-${source}`,
      `+${source}`,
      " ",
      " \t// Unicode café 😀 | + -  ",
    ]);
    const output = highlightFile(input);

    expect(output.size).toBe(4);

    for (const row of input.rows) {
      for (const theme of Object.values(themes)) {
        const side = row.role === "deletion" ? "old" : "new";
        const spans = output.get(row.line as DiffLine)?.[side]?.[theme.name];

        expect(spans?.map((span) => span.text).join("")).toBe(
          row.line?.raw.slice(1, -1),
        );

        if (row.role !== "context")
          expect(
            new Set(spans?.map((span) => span.color)).size,
          ).toBeGreaterThan(1);
      }
    }
  }
});

test("old/new fragments use their own paths and never tokenize across omitted or hunk boundaries", () => {
  const input = file("old.py", [
    "-old",
    "+new",
    " same",
    "-later",
    "+next",
    "-end",
    "+finish",
  ]);
  input.newPath = "new.ts";
  input.rows.splice(3, 0, {
    text: "... unreferenced lines omitted ...",
    role: "marker",
  });
  input.rows.splice(6, 0, { text: "@@ -10 +10 @@", role: "hunk" });

  const calls: string[] = [];
  const tokenizer: Tokenizer = (source, language, theme) => {
    if (theme === "github-light") calls.push(`${language}:${source}`);

    return source.split("\n").map((text) => [{ text, color: "#123456" }]);
  };

  highlightFile(input, tokenizer);

  expect(calls).toEqual([
    "python:old\nsame",
    "python:later",
    "python:end",
    "typescript:new\nsame",
    "typescript:next",
    "typescript:finish",
  ]);
});

test("multiline state is independent by side and resets for incomplete later hunks", () => {
  const input = file("x.ts", [
    "-/* old comment",
    '+const value = "new";',
    " still old comment",
    "-*/",
    "+const next = 2;",
    "+const final = 3;",
  ]);

  input.rows.splice(5, 0, { text: "@@ -20 +20 @@", role: "hunk" });

  const output = highlightFile(input);

  for (const theme of Object.values(themes)) {
    const context = output.get(input.rows[2].line as DiffLine);

    expect(context?.old?.[theme.name]).not.toEqual(context?.new?.[theme.name]);

    const later = output.get(input.rows[6].line as DiffLine)?.new?.[theme.name];

    expect(new Set(later?.map((span) => span.color)).size).toBeGreaterThan(1);
  }
});

test("failures, malformed tokens and unknown languages retain plain-text fallback", () => {
  const input = file("x.ts", ["+const value = 1;"]);

  for (const tokenizer of [
    () => {
      throw new Error("initialization or highlighting failed");
    },
    () => [[{ text: "changed" }]],
    () => [[{ text: "const value = 1;", color: "invalid" }]],
    () => [],
  ] satisfies Tokenizer[])
    expect(highlightFile(input, tokenizer).size).toBe(0);

  input.newPath = input.oldPath = "x.unknown";

  expect(
    highlightFile(input, () => {
      throw new Error("must not tokenize");
    }).size,
  ).toBe(0);
});

test("syntax colors remain readable on all diff backgrounds", () => {
  for (const theme of Object.values(themes)) {
    for (const [foreground, background] of [
      [theme.diff.context, theme.diff.background],
      [theme.diff.addition.foreground, theme.diff.addition.background],
      [theme.diff.deletion.foreground, theme.diff.deletion.background],
      [theme.diff.addition.foreground, theme.diff.addition.spanBackground],
      [theme.diff.deletion.foreground, theme.diff.deletion.spanBackground],
    ]) {
      expect(
        contrastRatio(
          readableTokenColor(background, foreground, background),
          background,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(readableTokenColor(undefined, foreground, background)).toBe(
        foreground,
      );
      expect(
        contrastRatio(
          readableTokenColor("#0969da", foreground, background),
          background,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("low-contrast syntax keeps its hue and GitHub's current keyword red stays red", () => {
  const light = themes["github-light"];
  const dark = themes["github-dark"];

  expect(
    readableTokenColor(
      "#cf222e",
      light.diff.addition.foreground,
      light.diff.addition.background,
    ),
  ).toBe("#cf222e");

  const adjusted = readableTokenColor(
    "#d73a49",
    light.diff.addition.foreground,
    light.diff.addition.background,
  );
  const rgb = (color: string) =>
    [1, 3, 5].map((offset) =>
      Number.parseInt(color.slice(offset, offset + 2), 16),
    );

  const [r, g, b] = rgb(adjusted);

  expect(r).toBeGreaterThan(b);
  expect(b).toBeGreaterThan(g);
  expect(r).toBeLessThan(0xd7);
  expect(
    contrastRatio(adjusted, light.diff.addition.background),
  ).toBeGreaterThanOrEqual(4.5);

  const brightened = readableTokenColor(
    "#800000",
    dark.diff.addition.foreground,
    dark.diff.deletion.background,
  );
  const [dr, dg, db] = rgb(brightened);

  expect(dr).toBeGreaterThan(dg);
  expect(dg).toBe(db);
  expect(dr).toBeGreaterThan(0x80);
  expect(
    contrastRatio(brightened, dark.diff.deletion.background),
  ).toBeGreaterThanOrEqual(4.5);
});

test("CRLF, no-newline markers and added/deleted paths preserve source without highlighting metadata", () => {
  const input = file("x.ts", ['+const text = "😀";  ', "+", "+// end"]);
  input.oldPath = null;

  for (const row of input.rows)
    if (row.line) row.line.raw = row.line.raw.replace(/\n$/, "\r\n");

  input.rows.splice(1, 0, {
    text: "\\ No newline at end of file",
    role: "marker",
    line: {
      raw: "\\ No newline at end of file\n",
      kind: "no-newline",
      oldLine: null,
      newLine: null,
    },
  });

  const output = highlightFile(input);

  expect(output.size).toBe(3);
  expect(output.has(input.rows[1].line as DiffLine)).toBe(false);
  expect(
    output
      .get(input.rows[0].line as DiffLine)
      ?.new?.["github-light"].map((span) => span.text)
      .join(""),
  ).toBe('const text = "😀";  ');

  input.newPath = null;
  input.oldPath = "deleted.ts";

  expect(highlightFile(input).size).toBe(3);
});
