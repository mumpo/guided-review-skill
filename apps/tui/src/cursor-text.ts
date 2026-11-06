import { StyledText, TextAttributes, TextRenderable } from "@opentui/core";

/** A narrative line keeps its inline styles while sharing the diff cursor. */
export class CursorText extends TextRenderable {
  // The base constructor assigns content through our setter before field setup.
  private declare source: StyledText | undefined;
  private declare selectedLine: number | undefined;
  private declare logicalLines: number[] | undefined;
  cursorEnabled = true;

  override get content(): StyledText {
    return super.content;
  }

  override set content(value: StyledText | string) {
    this.source =
      typeof value === "string"
        ? new StyledText([{ __isChunk: true, text: value }])
        : value;
    this.logicalLines = this.source.chunks
      .map((chunk) => chunk.text)
      .join("")
      .split("\n")
      .flatMap((text, line) => (text.trim() ? [line] : []));

    this.paintCursor();
  }

  setCursorLine(line?: number) {
    if (this.isDestroyed || this.selectedLine === line) return;

    this.selectedLine = line;
    this.paintCursor();
  }

  cursorLines(): number[] {
    return this.cursorEnabled ? (this.logicalLines ?? []) : [];
  }

  lineBounds(line: number) {
    const sources = this.lineInfo.lineSources;
    const first = Math.max(0, sources.indexOf(line));
    const last = Math.max(first, sources.lastIndexOf(line));

    return { top: this.y + first, bottom: this.y + last + 1 };
  }

  private paintCursor() {
    if (!this.source) return;
    if (this.selectedLine === undefined) {
      super.content = this.source;
      return;
    }

    let line = 0;
    const chunks = this.source.chunks.flatMap((chunk) =>
      chunk.text.split("\n").flatMap((text, index) => {
        const newline = index > 0;
        if (newline) line++;

        return [
          ...(newline ? [{ ...chunk, text: "\n" }] : []),
          {
            ...chunk,
            text,
            attributes:
              (chunk.attributes ?? 0) |
              (line === this.selectedLine ? TextAttributes.UNDERLINE : 0),
          },
        ];
      }),
    );

    super.content = new StyledText(chunks);
  }
}
