import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  type ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  TextAttributes,
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
  applyFragment,
  sourceFragments,
  readableTokenColor,
} from "./highlight";

import { sessionHighlights, type SyntaxService } from "./highlight-service";

import {
  type ChangedSpans,
  changedFileSpans,
  emphasizeSpans,
} from "./changed-spans";

/** Layout owns presentation only; all rows come from resolved captured changes. */
export class DiffView extends BoxRenderable {
  private controller = new AbortController();
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
  private collapsed = new Set<string>();
  private headers: {
    file: FileRows;
    box: BoxRenderable;
    chevron: TextRenderable;
    path: TextRenderable;
    added: TextRenderable;
    deleted: TextRenderable;
    content: BoxRenderable;
  }[] = [];
  private signature = "";
  private anchorEpoch = 0;
  private fills: { node: BoxRenderable; role: RowRole }[] = [];

  constructor(
    private renderer: CliRenderer,
    private body: ScrollBoxRenderable,
    theme: Theme,
    private highlights: SyntaxService = sessionHighlights(renderer),
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
    this.collapsed.clear();
    this.controller.abort();
    this.controller = new AbortController();
    this.syntax = new Map();
    this.changes = new Map(
      files.flatMap((file) => [...changedFileSpans(file)]),
    );
    this.preference = preference;
    this.rebuild();

    const signal = this.controller.signal;
    const fragments = files.flatMap((file) => [...sourceFragments(file)]);
    void Promise.all(
      fragments.map(async (fragment) => ({
        fragment,
        colors: await this.highlights.highlight(
          fragment.source,
          fragment.language,
          signal,
        ),
      })),
    ).then((results) => {
      if (signal.aborted || this.isDestroyed) return;

      for (const { fragment, colors } of results) {
        if (colors) applyFragment(this.syntax, fragment, colors);
      }
      this.setTheme(this.palette);
    });
  }

  protected destroySelf() {
    this.controller.abort();
    super.destroySelf();
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
    const anchor = this.logical.find(
      ({ node, file }) =>
        (!this.collapsed.has(file) ||
          this.headers.some((header) => header.box === node)) &&
        node.y + node.height > top,
    );
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

  toggleVisibleFile() {
    const top = this.body.viewport.y;
    const bottom = top + this.body.viewport.height;
    const header = this.headers.find(
      ({ box, content }) =>
        box.y < bottom &&
        Math.max(
          box.y + box.height,
          content.visible ? content.y + content.height : 0,
        ) > top,
    );
    if (header) this.toggleFile(header.file.id);
  }

  private toggleFile(id: string) {
    const header = this.headers.find(({ file }) => file.id === id);
    if (!header) return;

    this.anchorEpoch++;
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);

    header.content.visible = !this.collapsed.has(id);
    header.chevron.content = header.content.visible ? "⌄" : "›";
  }

  private fileHeader(file: FileRows) {
    const content = new BoxRenderable(this.renderer, {
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      visible: !this.collapsed.has(file.id),
    });
    const box = new BoxRenderable(this.renderer, {
      id: `file-header-${file.id}`,
      width: "100%",
      border: true,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      flexShrink: 0,
      gap: 1,
    });
    const button = new BoxRenderable(this.renderer, {
      width: 3,
      height: 1,
      flexShrink: 0,
      onMouseDown: (event) => {
        if (event.button !== 0) return;

        event.stopPropagation();
        this.toggleFile(file.id);
      },
    });
    const chevron = new TextRenderable(this.renderer, {
      content: content.visible ? "⌄" : "›",
      width: 3,
    });
    button.add(chevron);

    const name =
      file.oldPath && file.newPath && file.oldPath !== file.newPath
        ? `${file.oldPath} → ${file.newPath}`
        : (file.newPath ?? file.oldPath ?? file.id);
    const path = new TextRenderable(this.renderer, {
      content: name,
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      wrapMode: "char",
    });
    const added = new TextRenderable(this.renderer, {
      content: `+${file.additions ?? 0}`,
      attributes: TextAttributes.BOLD,
      flexShrink: 0,
    });
    const deleted = new TextRenderable(this.renderer, {
      content: `-${file.deletions ?? 0}`,
      attributes: TextAttributes.BOLD,
      flexShrink: 0,
    });

    for (const node of [button, path, added, deleted]) box.add(node);

    this.add(box);
    this.add(content);
    this.headers.push({ file, box, chevron, path, added, deleted, content });
    this.logical.push({ node: box, file: file.id, sources: [0] });

    return content;
  }

  private rebuild() {
    for (const child of this.getChildren()) child.destroyRecursively();

    this.headers = [];
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

      const content =
        file.oldPath || file.newPath ? this.fileHeader(file) : this;
      let seenHunk = false;

      for (const row of layoutFileRows(file, mode)) {
        if (
          row.full?.role === "file" ||
          (row.full?.role === "marker" &&
            (row.full.text ===
              "Old | New | Diff (selected lines; original hunk headers)" ||
              row.full.text ===
                "Old (left) | New (right) · selected lines; original hunk headers"))
        )
          continue;
        if (row.full?.role === "hunk") {
          // Keep separate hunks visibly separated without showing Git metadata.
          if (seenHunk)
            content.add(
              new BoxRenderable(this.renderer, { height: 1, flexShrink: 0 }),
            );
          seenHunk = true;
          continue;
        }
        let node: BoxRenderable | TextRenderable;
        if (row.full) {
          const full = row.full;
          const text = full.text;
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

        content.add(node);
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

    for (const { box, chevron, path, added, deleted } of this.headers) {
      box.backgroundColor = theme.surface;
      box.borderColor = theme.muted;
      for (const node of [chevron, path, added, deleted])
        node.bg = theme.surface;

      chevron.fg = theme.muted;
      path.fg = theme.diff.file;
      added.fg = theme.diff.statsAddition;
      deleted.fg = theme.diff.statsDeletion;
    }

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
