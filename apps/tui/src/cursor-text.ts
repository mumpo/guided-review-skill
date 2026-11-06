import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  StyledText,
  type TextChunk,
  type TextOptions,
  TextRenderable,
} from "@opentui/core";
import { cursorBackground } from "./cursor-highlight";
import type { ThemeName } from "./theme";

/** Logical narrative rows share a cursor background without changing layout. */
export class CursorText extends BoxRenderable {
  private source = new StyledText([]);
  private rows: {
    box: BoxRenderable;
    text: TextRenderable;
    chunks: TextChunk[];
  }[] = [];
  private cursorTheme: ThemeName = "github-dark";
  private selectedLine?: number;
  private logicalLines: number[] = [];
  private foreground?: string | RGBA;
  private wrapping: "none" | "char" | "word";
  private enabled = true;

  constructor(
    private renderer: CliRenderer,
    options: TextOptions,
  ) {
    super(renderer, {
      id: options.id,
      width: options.width ?? "100%",
      minWidth: options.minWidth ?? 0,
      flexShrink: options.flexShrink ?? 0,
      marginBottom: options.marginBottom,
      flexDirection: "column",
      backgroundColor: options.bg,
    });
    this.foreground = options.fg;
    this.wrapping = options.wrapMode ?? "word";

    this.content = options.content ?? "";
  }

  get content(): StyledText {
    return this.source;
  }

  set content(value: StyledText | string) {
    this.source =
      typeof value === "string"
        ? new StyledText([{ __isChunk: true, text: value }])
        : value;

    const lines: TextChunk[][] = [[]];
    for (const chunk of this.source.chunks) {
      chunk.text.split("\n").forEach((text, index) => {
        if (index) lines.push([]);
        lines[lines.length - 1].push({ ...chunk, text });
      });
    }

    while (this.rows.length > lines.length)
      this.rows.pop()?.box.destroyRecursively();

    this.logicalLines = [];
    lines.forEach((chunks, index) => {
      if (!this.rows[index]) {
        const box = new BoxRenderable(this.renderer, {
          width: "100%",
          minWidth: 0,
          minHeight: 1,
          flexShrink: 0,
          flexDirection: "column",
          backgroundColor: this.backgroundColor,
        });
        const text = new TextRenderable(this.renderer, {
          width: "100%",
          minWidth: 0,
          minHeight: 1,
          flexShrink: 0,
          wrapMode: this.wrapping,
          fg: this.foreground,
          bg: this.backgroundColor,
        });
        box.add(text);
        this.add(box);
        this.rows.push({ box, text, chunks: [] });
      }

      this.rows[index].chunks = chunks;
      if (chunks.some((chunk) => chunk.text.trim()))
        this.logicalLines.push(index);
    });

    this.paintCursor();
  }

  get plainText() {
    return this.source.chunks.map((chunk) => chunk.text).join("");
  }

  get selectedText() {
    return this.selectedLine === undefined
      ? ""
      : (this.rows[this.selectedLine]?.text.plainText ?? "");
  }

  get fg(): RGBA {
    return this.rows[0]?.text.fg ?? RGBA.fromHex("#ffffff");
  }

  set fg(value: string | RGBA) {
    this.foreground = value;
    for (const { text } of this.rows) text.fg = value;
  }

  get bg(): RGBA {
    return this.backgroundColor;
  }

  set bg(value: string | RGBA) {
    this.backgroundColor = value;
    this.paintCursor();
  }

  setCursorLine(line?: number) {
    if (this.isDestroyed || this.selectedLine === line) return;

    this.selectedLine = line;
    this.paintCursor();
  }

  get cursorEnabled() {
    return this.enabled;
  }

  set cursorEnabled(value: boolean) {
    this.enabled = value;
    this.paintCursor();
  }

  cursorLines(): number[] {
    return this.cursorEnabled ? this.logicalLines : [];
  }

  lineBounds(line: number) {
    const box = this.rows[line]?.box;

    return {
      top: box?.y ?? this.y,
      bottom: box ? box.y + box.height : this.y + this.height,
    };
  }

  setCursorTheme(theme: ThemeName) {
    this.cursorTheme = theme;
    this.paintCursor();
  }

  private paintCursor() {
    this.rows.forEach(({ box, text, chunks }, line) => {
      const selected = this.enabled && line === this.selectedLine;
      const background = selected
        ? cursorBackground(this.backgroundColor, this.cursorTheme)
        : this.backgroundColor;
      box.backgroundColor = background;
      text.bg = background;
      text.content = new StyledText(
        chunks.map((chunk) => ({
          ...chunk,
          bg: selected
            ? RGBA.fromHex(
                cursorBackground(
                  chunk.bg ?? this.backgroundColor,
                  this.cursorTheme,
                ),
              )
            : chunk.bg,
        })),
      );
    });
  }
}
