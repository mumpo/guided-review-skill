import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  type ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import {
  type DiffCell,
  type DiffMode,
  type FileRows,
  type RowRole,
  effectiveDiffMode,
  layoutFileRows,
} from "./diff";
import { type Theme, diffGutterBackground } from "./theme";
import {
  type HighlightedFile,
  highlightFile,
  readableTokenColor,
} from "./highlight";

import {
  type ChangedSpans,
  changedFileSpans,
  emphasizeSpans,
} from "./changed-spans";

/** Layout owns presentation only; all rows come from resolved captured changes. */
export class DiffView extends BoxRenderable {
  private files: FileRows[] = [];
  private syntax: HighlightedFile = new Map();
  private changes: ChangedSpans = new Map();
  private preference: DiffMode = "auto";
  private palette: Theme;
  private painted: { node: TextRenderable; cell: DiffCell }[] = [];
  private logical: {
    node: BoxRenderable | TextRenderable;
    file: string;
    sources: number[];
  }[] = [];
  private signature = "";
  private anchorEpoch = 0;
  private fills: { node: BoxRenderable; role: RowRole }[] = [];

  constructor(
    private renderer: CliRenderer,
    private body: ScrollBoxRenderable,
    theme: Theme,
  ) {
    super(renderer, {
      id: "changes",
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
    });
    this.palette = theme;
  }

  setFiles(files: FileRows[], preference: DiffMode) {
    this.anchorEpoch++;
    this.files = files;
    this.syntax = new Map(files.flatMap((file) => [...highlightFile(file)]));
    this.changes = new Map(
      files.flatMap((file) => [...changedFileSpans(file)]),
    );
    this.preference = preference;
    this.rebuild();
  }

  setMode(preference: DiffMode) {
    this.preference = preference;
    this.preserve(() => this.rebuild());
  }

  /** Called before the renderer lays out a new terminal size. */
  resizeLayout() {
    this.preserve(() => {
      const signature = this.layoutSignature();
      if (signature !== this.signature) this.rebuild();
    });
  }

  private layoutSignature() {
    return this.files
      .map((file) =>
        effectiveDiffMode(file, this.preference, this.availableWidth()),
      )
      .join(",");
  }

  private availableWidth() {
    // Root has one column of padding on each side; the scroll bar takes one.
    return Math.max(1, this.renderer.width - 3);
  }

  private preserve(change: () => void) {
    const epoch = ++this.anchorEpoch;
    const top = this.body.viewport.y;
    const anchor = this.logical.find(({ node }) => node.y + node.height > top);
    const oldY = anchor?.node.y;
    change();
    if (
      !anchor ||
      oldY === undefined ||
      oldY >= this.body.viewport.y + this.body.viewport.height ||
      oldY > top
    )
      return;
    this.body.afterLayout(() => {
      if (epoch !== this.anchorEpoch) return;
      const next = this.logical.find(
        (row) =>
          row.file === anchor.file &&
          row.sources.some((source) => anchor.sources.includes(source)),
      );
      if (next) this.body.scrollBy(next.node.y - oldY);
    });
  }

  private rebuild() {
    for (const child of this.getChildren()) child.destroyRecursively();
    this.painted = [];
    this.fills = [];
    this.logical = [];
    this.signature = this.layoutSignature();
    if (!this.files.length) return;
    this.add(
      new TextRenderable(this.renderer, { content: "\n", flexShrink: 0 }),
    );
    this.files.forEach((file, index) => {
      if (index)
        this.add(
          new TextRenderable(this.renderer, {
            content: "",
            height: 1,
            flexShrink: 0,
          }),
        );
      const mode = effectiveDiffMode(
        file,
        this.preference,
        this.availableWidth(),
      );
      for (const row of layoutFileRows(file, mode)) {
        let node: BoxRenderable | TextRenderable;
        if (row.full) {
          const full = row.full;
          const text =
            full === file.rows[0] && full.role === "file"
              ? `${full.text} [${mode}]`
              : full.text ===
                  "Old | New | Diff (selected lines; original hunk headers)"
                ? "Old   New   Diff (selected lines; original hunk headers)"
                : full.text;
          node = new BoxRenderable(this.renderer, {
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          });
          node.add(
            this.text({
              text: full.prefix ? text.slice(full.prefix.length) : text,
              prefix: full.prefix ?? "",
              role: full.role,
              line: full.line,
              side: full.role === "deletion" ? "old" : "new",
            }),
          );
          this.fills.push({ node, role: full.role });
        } else {
          node = new BoxRenderable(this.renderer, {
            width: "100%",
            flexDirection: "row",
            alignItems: "stretch",
            flexShrink: 0,
          });
          for (const [index, cell] of [row.left, row.right].entries()) {
            if (index)
              node.add(
                this.text({ text: " │ ", prefix: "", role: "marker" }, 3),
              );
            const pane = new BoxRenderable(this.renderer, {
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              flexDirection: "column",
            });
            if (cell) {
              this.fills.push({ node: pane, role: cell.role });
              pane.add(this.text(cell));
              if (cell.marker)
                pane.add(
                  this.text({ text: cell.marker, prefix: "", role: "marker" }),
                );
            }
            node.add(pane);
          }
        }
        this.add(node);
        this.logical.push({ node, file: file.id, sources: row.sources });
      }
    });
    this.setTheme(this.palette);
  }

  private text(cell: DiffCell, width: number | "100%" = "100%") {
    const node = new TextRenderable(this.renderer, {
      content: "",
      width,
      minWidth: 0,
      wrapMode: "char",
      flexShrink: 0,
    });
    this.painted.push({ node, cell });
    return node;
  }

  setTheme(theme: Theme) {
    this.palette = theme;
    this.backgroundColor = theme.diff.background;
    for (const { node, role } of this.fills) {
      node.backgroundColor =
        role === "addition" || role === "deletion"
          ? theme.diff[role].background
          : theme.diff.background;
    }
    for (const { node, cell } of this.painted) {
      const changed = cell.role === "addition" || cell.role === "deletion";
      const pair = changed
        ? theme.diff[cell.role as "addition" | "deletion"]
        : undefined;
      const foreground = pair?.foreground ?? this.foreground(cell.role);
      const background = pair?.background ?? theme.diff.background;
      node.fg = foreground;
      node.bg = background;
      const spans =
        cell.line && cell.side
          ? this.syntax.get(cell.line)?.[cell.side]?.[theme.name]
          : undefined;
      node.content = new StyledText([
        {
          __isChunk: true,
          // Prefixes are generated gutters, never captured source text.
          text: cell.prefix.replaceAll(" | ", "   "),
          bg: RGBA.fromHex(
            cell.role === "addition" || cell.role === "deletion"
              ? diffGutterBackground(theme, cell.role)
              : theme.surface,
          ),
          fg: RGBA.fromHex(changed ? foreground : theme.diff.lineNumber),
        },
        ...(cell.line && cell.line.kind !== "no-newline"
          ? [
              {
                __isChunk: true as const,
                text: cell.text.slice(0, 1),
                fg: RGBA.fromHex(foreground),
                bg: RGBA.fromHex(background),
              },
              ...emphasizeSpans(
                spans ?? [{ text: cell.text.slice(1) }],
                this.changes.get(cell.line) ?? [],
              ).map((span) => {
                const actualBackground =
                  span.changed && pair ? pair.spanBackground : background;
                return {
                  __isChunk: true as const,
                  text: span.text,
                  fg: RGBA.fromHex(
                    readableTokenColor(
                      span.color,
                      foreground,
                      actualBackground,
                    ),
                  ),
                  bg: RGBA.fromHex(actualBackground),
                };
              }),
            ]
          : [
              {
                __isChunk: true as const,
                text: cell.text,
                fg: RGBA.fromHex(foreground),
              },
            ]),
      ]);
    }
  }

  private foreground(role: RowRole) {
    const diff = this.palette.diff;
    return role === "file"
      ? diff.file
      : role === "hunk"
        ? diff.hunk
        : role === "marker"
          ? diff.marker
          : diff.context;
  }
}
