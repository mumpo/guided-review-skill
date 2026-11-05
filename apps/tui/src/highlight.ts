import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import javascript from "shiki/langs/javascript.mjs";
import typescript from "shiki/langs/typescript.mjs";
import jsx from "shiki/langs/jsx.mjs";
import tsx from "shiki/langs/tsx.mjs";
import python from "shiki/langs/python.mjs";
import go from "shiki/langs/go.mjs";
import rust from "shiki/langs/rust.mjs";
import java from "shiki/langs/java.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import json from "shiki/langs/json.mjs";
import yaml from "shiki/langs/yaml.mjs";
import html from "shiki/langs/html.mjs";
import css from "shiki/langs/css.mjs";
import shell from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import markdown from "shiki/langs/markdown.mjs";
import light from "shiki/themes/github-light-default.mjs";
import dark from "shiki/themes/github-dark-default.mjs";
import type { DiffLine } from "../../../packages/core/src";
import type { FileRows } from "./diff";
import type { ThemeName } from "./theme";

const extensions: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
};

export function languageForPath(path?: string | null): string | undefined {
  const name = path?.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const extension = name.slice(dot + 1).toLowerCase();
  return dot > 0 && Object.hasOwn(extensions, extension)
    ? extensions[extension]
    : undefined;
}

/** Fence info strings select bundled grammars only, never external parsers. */
export function languageForFence(info = ""): string | undefined {
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  if (name === "c++") return "cpp";
  if (name === "shell") return "shellscript";
  if (Object.hasOwn(extensions, name)) return extensions[name];
  return Object.values(extensions).includes(name) ? name : undefined;
}

export interface SyntaxSpan {
  text: string;
  color?: string;
}
export type Tokenizer = (
  source: string,
  language: string,
  theme: ThemeName,
) => SyntaxSpan[][];
export type HighlightedFile = Map<
  DiffLine,
  Partial<Record<"old" | "new", Record<ThemeName, SyntaxSpan[]>>>
>;

let highlighter: ReturnType<typeof createHighlighterCoreSync> | undefined;
let unavailable = false;
const tokenize: Tokenizer = (source, language, theme) => {
  if (unavailable) throw new Error("Highlighter unavailable");
  if (!highlighter) {
    try {
      highlighter = createHighlighterCoreSync({
        themes: [
          { ...light, name: "github-light" },
          { ...dark, name: "github-dark" },
        ],
        langs: [
          javascript,
          typescript,
          jsx,
          tsx,
          python,
          go,
          rust,
          java,
          c,
          cpp,
          json,
          yaml,
          html,
          css,
          shell,
          sql,
          markdown,
        ],
        engine: createJavaScriptRegexEngine(),
      });
    } catch (error) {
      unavailable = true;
      throw error;
    }
  }
  return highlighter
    .codeToTokens(source, { lang: language, theme })
    .tokens.map((line) =>
      line.map((token) => ({ text: token.content, color: token.color })),
    );
};

/** Validate exact reconstruction before either viewer uses syntax colors. */
export function highlightSource(
  source: string,
  language: string | undefined,
  tokenizer: Tokenizer = tokenize,
): Record<ThemeName, SyntaxSpan[][]> | undefined {
  if (!language) return;
  const bodies = source.split("\n");
  try {
    const colors = {} as Record<ThemeName, SyntaxSpan[][]>;
    for (const theme of ["github-light", "github-dark"] as const) {
      const lines = tokenizer(source, language, theme);
      if (
        lines.length !== bodies.length ||
        lines.some(
          (spans, i) =>
            spans.map((span) => span.text).join("") !== bodies[i] ||
            spans.some(
              (span) =>
                span.color !== undefined && !/^#[\da-f]{6}$/i.test(span.color),
            ),
        )
      )
        return;
      colors[theme] = lines;
    }
    return colors;
  } catch {
    // Highlighting must never prevent reading captured content.
    return;
  }
}

/** Only selected source enters the tokenizer; gaps reset both independent streams. */
export function highlightFile(
  file: FileRows,
  tokenizer: Tokenizer = tokenize,
): HighlightedFile {
  const result: HighlightedFile = new Map();
  for (const side of ["old", "new"] as const) {
    const language = languageForPath(
      side === "old"
        ? (file.oldPath ?? file.newPath)
        : (file.newPath ?? file.oldPath),
    );
    if (!language) continue;
    let fragment: DiffLine[] = [];
    const flush = () => {
      if (!fragment.length) return;
      const bodies = fragment.map((line) =>
        line.raw.replace(/\r?\n$/, "").slice(1),
      );
      const colors = highlightSource(bodies.join("\n"), language, tokenizer);
      if (colors) {
        fragment.forEach((line, i) => {
          const entry = result.get(line) ?? {};
          entry[side] = {
            "github-light": colors["github-light"][i],
            "github-dark": colors["github-dark"][i],
          };
          result.set(line, entry);
        });
      }
      fragment = [];
    };
    for (const row of file.rows) {
      const line = row.line;
      if (line?.kind === "no-newline") continue;
      if (!line) {
        flush();
        continue;
      }
      if (
        line.kind === "context" ||
        line.kind === (side === "old" ? "deletion" : "addition")
      )
        fragment.push(line);
    }
    flush();
  }
  return result;
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function readableTokenColor(
  color: string | undefined,
  foreground: string,
  background: string,
): string {
  if (!color) return foreground;
  if (contrastRatio(color, background) >= 4.5) return color;

  // Mixing toward black/white preserves RGB hue instead of adopting the diff's hue.
  // Choose the endpoint with greater contrast, then find the smallest adjustment.
  const endpoint =
    contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
      ? 0
      : 255;
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
  const mix = (amount: number) =>
    `#${channels
      .map((channel) =>
        Math.round(channel + (endpoint - channel) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(mix(middle), background) >= 4.5) high = middle;
    else low = middle;
  }
  return mix(high);
}
