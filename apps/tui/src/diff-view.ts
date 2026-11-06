import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  type ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  TextAttributes,
  TextareaRenderable,
  type KeyEvent,
  type PasteEvent,
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
import {
  commentKey,
  type CommentTarget,
  type PublishedComment,
  type PublishComment,
} from "./comments";

interface CursorRow {
  node: BoxRenderable | TextRenderable;
  file: string;
  targets: CommentTarget[];
}

interface Draft {
  body: string;
  cursor: number;
  pending?: boolean;
  error?: string;
}

/** Layout owns presentation only; all rows come from resolved captured changes. */
export class DiffView extends BoxRenderable {
  private controller = new AbortController();
  private files: FileRows[] = [];
  private syntax: HighlightedFile = new Map();
  private changes: ChangedSpans = new Map();
  private preference: DiffMode = "auto";
  private palette: Theme;
  private painted: { node: TextRenderable; cell: DiffCell; file?: string }[] =
    [];
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
  private cursorRows: CursorRow[] = [];
  private selected?: CommentTarget;
  private preferredSide: "old" | "new" = "new";
  private active?: CommentTarget;
  private editor?: TextareaRenderable;
  private drafts = new Map<string, Draft>();
  private comments = new Map<string, PublishedComment[]>();
  private commentBoxes: BoxRenderable[] = [];
  private commentText: TextRenderable[] = [];

  constructor(
    private renderer: CliRenderer,
    private body: ScrollBoxRenderable,
    theme: Theme,
    private highlights: SyntaxService = sessionHighlights(renderer),
    private publish?: PublishComment,
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
    this.captureEditor();
    this.active = undefined;
    this.selected = undefined;
    this.preferredSide = "new";
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

  private captureEditor() {
    if (!this.editor || !this.active) return;

    const draft = this.drafts.get(commentKey(this.active));
    if (draft) {
      draft.body = this.editor.plainText;
      draft.cursor = this.editor.cursorOffset;
    }
  }

  handleCommentPaste(event: PasteEvent) {
    if (this.active && this.drafts.get(commentKey(this.active))?.pending)
      event.preventDefault();
  }

  /** Editor input must be handled before viewer shortcuts. */
  handleCommentKey(key: KeyEvent) {
    if (!this.active) return false;

    if (key.name === "escape") {
      this.captureEditor();
      this.active = undefined;
      this.preserve(() => this.rebuild());
      key.preventDefault();
    } else if (key.ctrl && key.name === "s") {
      this.captureEditor();
      void this.submitComment();
      key.preventDefault();
    } else if (this.drafts.get(commentKey(this.active))?.pending) {
      key.preventDefault();
    }

    return true;
  }

  openComment() {
    if (!this.selected) return;

    this.active = { ...this.selected };
    const key = commentKey(this.active);
    if (!this.drafts.has(key)) this.drafts.set(key, { body: "", cursor: 0 });

    this.preserve(() => this.rebuild());
    this.revealCursor();
  }

  private async submitComment() {
    const target = this.active;
    if (!target) return;

    const key = commentKey(target);
    const draft = this.drafts.get(key);
    if (!draft || draft.pending) return;

    if (!draft.body.trim()) {
      draft.error = "Write a comment before publishing.";
      this.preserve(() => this.rebuild());
      return;
    }

    draft.pending = true;
    draft.error = undefined;
    this.preserve(() => this.rebuild());

    try {
      if (!this.publish) throw new Error("Comment publishing is unavailable.");

      const posted = await this.publish(target, draft.body);
      this.comments.set(key, [...(this.comments.get(key) ?? []), posted]);
      this.drafts.delete(key);
      if (this.active && commentKey(this.active) === key)
        this.active = undefined;
    } catch (error) {
      draft.pending = false;
      draft.error = error instanceof Error ? error.message : String(error);
    }

    if (!this.isDestroyed) this.preserve(() => this.rebuild());
  }

  moveCursor(direction: number) {
    const rows = this.cursorRows.filter((row) => !this.collapsed.has(row.file));
    if (!rows.length) {
      this.selected = undefined;
      this.setTheme(this.palette);
      return;
    }

    const current = rows.findIndex((row) =>
      row.targets.some((target) => this.isSelected(target)),
    );
    const index =
      current < 0
        ? 0
        : Math.max(0, Math.min(rows.length - 1, current + direction));
    this.selected =
      rows[index].targets.find(
        (target) => target.side === this.preferredSide,
      ) ?? rows[index].targets[0];
    this.setTheme(this.palette);
    this.revealCursor();
  }

  switchSide() {
    const row = this.cursorRows.find((row) =>
      row.targets.some((target) => this.isSelected(target)),
    );
    const other = row?.targets.find(
      (target) => target.side !== this.selected?.side,
    );
    if (!other) return;

    this.selected = other;
    this.preferredSide = other.side;
    this.setTheme(this.palette);
  }

  private isSelected(target: CommentTarget) {
    return this.selected && commentKey(this.selected) === commentKey(target);
  }

  private revealCursor() {
    this.body.afterLayout(() => {
      if (this.isDestroyed) return;

      const row = this.cursorRows.find((row) =>
        row.targets.some((target) => this.isSelected(target)),
      );
      if (!row) return;

      const bottom = this.editor
        ? this.editor.y + this.editor.height + 1
        : row.node.y + row.node.height;
      const top = this.body.viewport.y;
      const height = this.body.viewport.height;
      if (row.node.y < top) this.body.scrollBy(row.node.y - top);
      else if (bottom > top + height)
        this.body.scrollBy(Math.min(bottom - top - height, row.node.y - top));
    });
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
    if (this.active) return;

    const header = this.headers.find(({ file }) => file.id === id);
    if (!header) return;

    this.anchorEpoch++;
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);

    header.content.visible = !this.collapsed.has(id);
    header.chevron.content = header.content.visible ? "⌄" : "›";
    if (this.selected?.fileId === id && this.collapsed.has(id))
      this.moveCursor(1);
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
    this.captureEditor();
    this.editor = undefined;
    for (const child of this.getChildren()) child.destroyRecursively();

    this.headers = [];
    this.painted = [];
    this.fills = [];
    this.logical = [];
    this.cursorRows = [];
    this.commentBoxes = [];
    this.commentText = [];
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
            this.text(
              {
                text: full.prefix ? text.slice(full.prefix.length) : text,
                prefix: full.prefix ?? "",
                role: full.role,
                line: full.line,
                side: full.role === "deletion" ? "old" : "new",
              },
              "100%",
              file.id,
            ),
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
              pane.add(this.text(cell, "100%", file.id));
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

        const targets: CommentTarget[] = [];
        for (const source of row.sources) {
          const line = file.rows[source].line;
          if (!line || line.kind === "no-newline") continue;

          const sides: ("old" | "new")[] =
            line.kind === "deletion"
              ? ["old"]
              : line.kind === "addition" || mode === "inline"
                ? ["new"]
                : ["old", "new"];
          for (const side of sides) {
            const number = side === "old" ? line.oldLine : line.newLine;
            if (number !== undefined && number !== null)
              targets.push({
                fileId: file.id,
                path: file.newPath ?? file.oldPath ?? "",
                side,
                line: number,
              });
          }
        }

        if (targets.length) {
          this.cursorRows.push({ node, file: file.id, targets });
          // Inline context has one visible cell, but old-side comments still attach
          // to that same captured source row after switching from split mode.
          const commentTargets = [...targets];
          if (mode === "inline") {
            const line = row.full?.line;
            if (line?.kind === "context" && line.oldLine != null) {
              commentTargets.push({
                ...targets[0],
                side: "old",
                line: line.oldLine,
              });
            }
          }
          this.renderComments(content, commentTargets, mode);
        }
      }
    });

    if (
      !this.cursorRows.some((row) =>
        row.targets.some((target) => this.isSelected(target)),
      )
    ) {
      // Keep the selected captured context line when inline mode hides its old cell.
      const file = this.files.find((file) => file.id === this.selected?.fileId);
      const source = file?.rows.find(
        (row) =>
          row.line?.kind === "context" &&
          row.line.oldLine === this.selected?.line,
      );
      const equivalent = this.selected?.side === "old" && source?.line?.newLine;
      const replacement =
        equivalent &&
        this.cursorRows
          .flatMap((row) => row.targets)
          .find(
            (target) =>
              target.fileId === file?.id &&
              target.side === "new" &&
              target.line === equivalent,
          );
      const first = this.cursorRows.find(
        (row) => !this.collapsed.has(row.file),
      );
      this.selected =
        replacement ||
        first?.targets.find((target) => target.side === "new") ||
        first?.targets[0];
    }

    this.setTheme(this.palette);
    if (this.editor) {
      const editor = this.editor as TextareaRenderable;
      editor.focus();
      const draft = this.active && this.drafts.get(commentKey(this.active));
      if (draft) editor.cursorOffset = draft.cursor;
    }
  }

  private renderComments(
    content: BoxRenderable,
    targets: CommentTarget[],
    mode: "inline" | "side-by-side",
  ) {
    for (const target of targets) {
      const key = commentKey(target);
      const published = this.comments.get(key) ?? [];
      const active = this.active && commentKey(this.active) === key;
      const draft = this.drafts.get(key);
      const status = draft?.pending || draft?.error;
      if (!published.length && !active && !status) continue;

      const row = new BoxRenderable(this.renderer, {
        width: "100%",
        flexDirection: "row",
        flexShrink: 0,
      });
      if (mode === "side-by-side") {
        row.add(
          new BoxRenderable(this.renderer, { flexGrow: 1, flexBasis: 0 }),
        );
        row.add(new BoxRenderable(this.renderer, { width: 3 }));
      }

      // Keep borders/padding inside an equal-width pane so they do not shift
      // the editor left relative to the code pane above it.
      const pane = new BoxRenderable(this.renderer, {
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        flexDirection: "column",
      });
      const box = new BoxRenderable(this.renderer, {
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        flexDirection: "column",
        border: true,
        borderColor: this.palette.navigation.foreground,
        backgroundColor: this.palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
      });
      this.commentBoxes.push(box);
      const text = (value: string) => {
        const node = new TextRenderable(this.renderer, {
          content: value,
          width: "100%",
          wrapMode: "word",
          flexShrink: 0,
          fg: this.palette.text,
          bg: this.palette.surface,
        });
        this.commentText.push(node);
        box.add(node);
      };

      text(
        `${target.path} · ${target.side === "old" ? "old" : "new"} line ${target.line}`,
      );
      for (const comment of published) {
        text(`${comment.author}: ${comment.body}\n${comment.url}`);
      }

      if (active) {
        if (draft) {
          this.editor = new TextareaRenderable(this.renderer, {
            id: "comment-editor",
            width: "100%",
            height: 5,
            flexShrink: 0,
            initialValue: draft.body,
            wrapMode: "word",
            backgroundColor: this.palette.background,
            textColor: this.palette.text,
            focusedBackgroundColor: this.palette.background,
            focusedTextColor: this.palette.text,
            keyBindings: [{ name: "return", action: "newline" }],
            onContentChange: () => this.captureEditor(),
          });
          box.add(this.editor);
          text(draft.pending ? "Publishing…" : "Esc: close · Ctrl+s: publish");
          if (draft.error) text(draft.error);
        }
      } else if (status) {
        text(
          draft?.pending
            ? "Publishing…"
            : `${draft?.error}\nPress c on this line to reopen the draft.`,
        );
      }

      pane.add(box);
      row.add(pane);
      content.add(row);
    }
  }

  private text(cell: DiffCell, width: number | "100%" = "100%", file?: string) {
    const node = new TextRenderable(this.renderer, {
      content: "",
      width,
      minWidth: 0,
      wrapMode: "char",
      flexShrink: 0,
    });

    this.painted.push({ node, cell, file });

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

    for (const { node, cell, file } of this.painted) {
      const selected =
        this.selected &&
        cell.line &&
        cell.side === this.selected.side &&
        file === this.selected.fileId &&
        (cell.side === "old" ? cell.line.oldLine : cell.line.newLine) ===
          this.selected.line;
      node.attributes = selected ? TextAttributes.UNDERLINE : 0;
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
          text: selected
            ? cell.prefix.replaceAll(" | ", "   ").replace(/ $/, "▸")
            : cell.prefix.replaceAll(" | ", "   "),
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

    // Comment boxes are rebuilt only for layout/state changes; recolor in place.
    for (const box of this.commentBoxes) {
      box.borderColor = theme.navigation.foreground;
      box.backgroundColor = theme.surface;
    }
    for (const node of this.commentText) {
      node.fg = theme.text;
      node.bg = theme.surface;
    }
    if (this.editor) {
      this.editor.backgroundColor = theme.background;
      this.editor.textColor = theme.text;
      this.editor.focusedBackgroundColor = theme.background;
      this.editor.focusedTextColor = theme.text;
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
