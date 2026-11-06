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

/** Validate exact reconstruction before either viewer uses syntax colors. */
export function highlightSource(
  source: string,
  language: string | undefined,
  tokenizer: Tokenizer,
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

/** Only selected source enters the tokenizer; gaps reset independent streams. */
export function* sourceFragments(file: FileRows) {
  for (const side of ["old", "new"] as const) {
    const language = languageForPath(
      side === "old"
        ? (file.oldPath ?? file.newPath)
        : (file.newPath ?? file.oldPath),
    );
    if (!language) continue;

    let lines: DiffLine[] = [];
    for (const row of [...file.rows, { text: "", role: "marker" as const }]) {
      const line = "line" in row ? row.line : undefined;
      if (line?.kind === "no-newline") continue;
      if (!line) {
        if (lines.length)
          yield {
            side,
            language,
            lines,
            source: lines
              .map((item) => item.raw.replace(/\r?\n$/, "").slice(1))
              .join("\n"),
          };
        lines = [];
      } else if (
        line.kind === "context" ||
        line.kind === (side === "old" ? "deletion" : "addition")
      ) {
        lines.push(line);
      }
    }
  }
}

export type SourceColors = Record<ThemeName, SyntaxSpan[][]>;

export function applyFragment(
  result: HighlightedFile,
  fragment: { side: "old" | "new"; lines: DiffLine[] },
  colors: SourceColors,
) {
  fragment.lines.forEach((line, i) => {
    const entry = result.get(line) ?? {};
    entry[fragment.side] = {
      "github-light": colors["github-light"][i],
      "github-dark": colors["github-dark"][i],
    };
    result.set(line, entry);
  });
}

export function highlightFile(
  file: FileRows,
  tokenizer: Tokenizer,
): HighlightedFile {
  const result: HighlightedFile = new Map();

  for (const fragment of sourceFragments(file)) {
    const colors = highlightSource(
      fragment.source,
      fragment.language,
      tokenizer,
    );
    if (colors) applyFragment(result, fragment, colors);
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
