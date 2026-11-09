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
  type ReviewThread,
  type ThreadService,
  reactionChoices,
  type ReactionContent,
} from "./comments";
import {
  keyAction,
  actionKeys,
  resolveKeybindings,
  type Keybindings,
} from "../../../packages/preferences/src/keybindings";
import { SearchText, revealSearch, type SearchTarget } from "./search";
import { cursorBackground } from "./cursor-highlight";

interface CursorRow {
  node: BoxRenderable | TextRenderable;
  file: string;
  targets: CommentTarget[];
  header?: boolean;
  textKey?: string;
  text?: SearchText;
  thread?: ReviewThread;
  comment?: PublishedComment;
  threadBody?: boolean;
}

export interface Draft {
  body: string;
  cursor: number;
  pending?: boolean;
  error?: string;
}

export interface CommentState {
  drafts: Map<string, Draft>;
  threads: Map<string, ReviewThread>;
  expanded: Map<string, boolean>;
  unfolded: boolean;
  service?: ThreadService;
  openReactions?: (comment: PublishedComment) => void;
  reactionPending: Set<number>;
  reactionErrors: Map<number, string>;
  listeners: Set<() => void>;
}

export function createCommentState(
  unfolded = false,
  service?: ThreadService,
): CommentState {
  return {
    drafts: new Map(),
    threads: new Map(),
    expanded: new Map(),
    unfolded,
    service,
    reactionPending: new Set(),
    reactionErrors: new Map(),
    listeners: new Set(),
  };
}

export function notifyComments(state: CommentState) {
  for (const listener of state.listeners) listener();
}

export async function toggleReaction(
  state: CommentState,
  comment: PublishedComment,
  content: ReactionContent,
) {
  if (state.reactionPending.has(comment.id)) return;

  state.reactionPending.add(comment.id);
  state.reactionErrors.delete(comment.id);
  notifyComments(state);
  try {
    if (!state.service) throw new Error("Reactions are unavailable.");

    comment.reactions = await state.service.react(
      comment,
      content,
      comment.reactions?.find((reaction) => reaction.content === content)
        ?.viewerHasReacted ?? false,
    );
  } catch (error) {
    state.reactionErrors.set(
      comment.id,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    state.reactionPending.delete(comment.id);
    notifyComments(state);
  }
}

/** Layout owns presentation only; all rows come from resolved captured changes. */
export class DiffView extends BoxRenderable {
  private controller = new AbortController();
  private files: FileRows[] = [];
  private syntax: HighlightedFile = new Map();
  private changes: ChangedSpans = new Map();
  private preference: DiffMode = "auto";
  private palette: Theme;
  private painted: { node: SearchText; cell: DiffCell }[] = [];
  private logical: {
    node: BoxRenderable | TextRenderable;
    file: string;
    sources: number[];
    key?: string;
    thread?: ReviewThread;
  }[] = [];
  private collapsed = new Set<string>();
  private headers: {
    file: FileRows;
    box: BoxRenderable;
    chevron: TextRenderable;
    path: SearchText;
    added: SearchText;
    deleted: SearchText;
    content: BoxRenderable;
  }[] = [];
  private signature = "";
  private anchorEpoch = 0;
  private fills: { node: BoxRenderable; role: RowRole }[] = [];
  private cursorBoxes: {
    box: BoxRenderable;
    cell: DiffCell;
    file: string;
  }[] = [];
  private cursorRows: CursorRow[] = [];
  private selected?: CommentTarget;
  private selectedText?: string;
  private searchEntries: (SearchTarget & { order: number[] })[] = [];
  private selectedHeader?: string;
  private preferredSide: "old" | "new" = "new";
  private cursorActive = true;
  private active?: CommentTarget;
  private editor?: TextareaRenderable;
  private commentBoxes: BoxRenderable[] = [];
  private commentText: SearchText[] = [];
  private columns?: number;
  onFocus?: (focus: () => void) => boolean;
  private onComments = () => this.preserve(() => this.rebuild());

  private get drafts() {
    return this.commentState.drafts;
  }

  private get focusedRow() {
    return this.cursorRows.find((row) => this.matchesCursor(row));
  }

  private expanded(thread: ReviewThread) {
    return (
      this.commentState.expanded.get(thread.id) ?? this.commentState.unfolded
    );
  }

  openReactions() {
    if (this.cursorActive && this.focusedRow?.comment)
      this.commentState.openReactions?.(this.focusedRow.comment);
  }

  private toggleThread(thread: ReviewThread) {
    if (this.active) return;

    this.commentState.expanded.set(thread.id, !this.expanded(thread));
    const header = this.cursorRows.find(
      (row) => row.thread === thread && !row.threadBody,
    );
    if (this.cursorActive && this.focusedRow?.thread === thread)
      this.selectRow(header);
    notifyComments(this.commentState);
    this.revealCursor();
  }

  get editing() {
    return !!this.active;
  }

  get cursorFile() {
    return (
      this.selectedHeader ??
      this.selected?.fileId ??
      this.cursorRows.find((row) => row.textKey === this.selectedText)?.file
    );
  }

  searchTargets(): SearchTarget[] {
    return this.searchEntries;
  }

  private addSearchTarget(
    id: string,
    node: SearchText,
    file: string,
    row: CursorRow,
    offset = 0,
    text = node.plainText,
    target?: CommentTarget,
    order: number[] = [-1, this.searchEntries.length],
  ) {
    const entry: SearchTarget & { order: number[] } = {
      order: [
        this.files.findIndex((candidate) => candidate.id === file),
        ...order,
      ],
      id,
      node,
      text,
      offset,
      selected: () =>
        this.cursorActive &&
        this.matchesCursor(row) &&
        (!target || this.isSelected(target) === true),
      focus: (character: number) => {
        this.anchorEpoch++;
        if (this.collapsed.has(file)) this.toggleFile(file);
        if (row.thread && !this.expanded(row.thread)) {
          this.commentState.expanded.set(row.thread.id, true);
          this.refreshThreadVisibility();
        }
        this.selectRow(row);
        if (target) {
          this.selected = target;
          this.preferredSide = target.side;
        }
        this.cursorActive = true;
        this.setTheme(this.palette);
        revealSearch(this.body, node, offset + character);
      },
    };
    this.searchEntries.push(entry);
    return entry;
  }

  private indexSearchRow(
    file: FileRows,
    sources: number[],
    start: number,
    row: CursorRow,
  ) {
    const cells = this.painted.slice(start);
    for (const source of sources) {
      const original = file.rows[source];
      const line = original.line;
      const matches = cells.filter(({ cell }) =>
        line?.kind === "no-newline"
          ? cell.line === line || cell.text === line.raw.replace(/\r?\n$/, "")
          : cell.line === line && (line || cell.text.trim()),
      );
      if (!matches.length) continue;

      const primary =
        matches.find(({ cell }) => cell.side === "new") ?? matches[0];
      const sourceText = line && line.kind !== "no-newline";
      const offset =
        primary.cell.prefix.replaceAll(" | ", "   ").length +
        (sourceText ? 1 : 0);
      let focusRow = row;
      if (line?.kind === "no-newline" && row.targets.length) {
        focusRow = {
          node: primary.node,
          file: file.id,
          targets: [],
          textKey: `${file.id}:marker:${source}`,
          text: primary.node,
        };
        this.cursorRows.push(focusRow);
      }
      const target = focusRow.targets.find(
        (target) => target.side === primary.cell.side,
      );
      const entry = this.addSearchTarget(
        `${file.id}:source:${source}`,
        primary.node,
        file.id,
        focusRow,
        offset,
        sourceText ? primary.cell.text.slice(1) : primary.cell.text,
        target,
        [source, 0],
      );
      entry.mirrors = matches
        .filter((other) => other !== primary)
        .map(({ node, cell }) => ({
          node,
          offset:
            cell.prefix.replaceAll(" | ", "   ").length + (sourceText ? 1 : 0),
        }));
    }
  }

  focusFile(id: string) {
    const row = this.visibleCursorRows().find(
      (row) => row.header && row.file === id,
    );
    if (!row) return false;

    this.selectRow(row);
    this.setCursorActive(true);
    this.setTheme(this.palette);
    return true;
  }

  fileHeaderNode(id: string) {
    return this.headers.find(({ file }) => file.id === id)?.box;
  }

  focusLastCursor() {
    const rows = this.visibleCursorRows();
    if (!rows.length) return false;

    this.selectRow(rows[rows.length - 1]);
    this.setCursorActive(true);
    this.setTheme(this.palette);
    this.revealCursor();
    return true;
  }

  constructor(
    private renderer: CliRenderer,
    private body: ScrollBoxRenderable,
    theme: Theme,
    private highlights: SyntaxService = sessionHighlights(renderer),
    private publish?: PublishComment,
    private bindings: Keybindings = resolveKeybindings(),
    private commentState: CommentState = createCommentState(),
  ) {
    super(renderer, {
      id: "changes",
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
    });
    this.palette = theme;
    this.commentState.listeners.add(this.onComments);
  }

  setFiles(files: FileRows[], preference: DiffMode) {
    this.captureEditor();
    this.active = undefined;
    this.selected = undefined;
    this.selectedText = undefined;
    this.selectedHeader = undefined;
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
    this.commentState.listeners.delete(this.onComments);
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

    const action = keyAction(this.bindings, key, "editor");
    if (action === "close_comment") {
      this.captureEditor();
      this.active = undefined;
      this.preserve(() => this.rebuild());
      key.preventDefault();
    } else if (action === "publish_comment") {
      this.captureEditor();
      void this.submitComment();
      key.preventDefault();
    } else if (this.drafts.get(commentKey(this.active))?.pending) {
      key.preventDefault();
    }

    return true;
  }

  openComment() {
    if (!this.cursorActive) return;

    const thread = this.focusedRow?.thread;
    const file = this.files.find((file) => file.id === this.cursorFile);
    if (thread && file) {
      this.commentState.expanded.set(thread.id, true);
      this.active = {
        fileId: file.id,
        path: thread.path,
        side: thread.side,
        line: thread.line ?? 1,
        replyTo: thread.id,
      };
    } else if (this.selected) this.active = { ...this.selected };
    else return;
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
      if (target.replyTo) {
        const thread = this.commentState.threads.get(target.replyTo);
        if (!thread || !this.commentState.service)
          throw new Error("Reply publishing is unavailable.");

        const posted = await this.commentState.service.reply(
          thread,
          draft.body,
        );
        thread.comments = [
          ...new Map(
            [...thread.comments, posted].map((comment) => [
              comment.id,
              comment,
            ]),
          ).values(),
        ];
      } else {
        if (!this.publish)
          throw new Error("Comment publishing is unavailable.");

        const posted = await this.publish(target, draft.body);
        const thread: ReviewThread = {
          id: `local:${posted.id}`,
          path: target.path,
          side: target.side,
          line: target.line,
          fileId: target.fileId,
          resolved: false,
          outdated: false,
          comments: [posted],
        };
        this.commentState.threads.set(thread.id, thread);
        this.commentState.expanded.set(thread.id, true);
      }
      this.drafts.delete(key);
      if (this.active && commentKey(this.active) === key)
        this.active = undefined;
    } catch (error) {
      draft.pending = false;
      draft.error = error instanceof Error ? error.message : String(error);
    }

    for (const listener of this.commentState.listeners) listener();
  }

  private visibleCursorRows() {
    return this.cursorRows.filter(
      (row) =>
        (row.header || !this.collapsed.has(row.file)) &&
        (row.thread
          ? !row.threadBody || this.expanded(row.thread)
          : !row.textKey || row.textKey === this.selectedText),
    );
  }

  private matchesCursor(row: CursorRow) {
    return row.header
      ? this.selectedHeader === row.file
      : row.textKey
        ? this.selectedText === row.textKey
        : row.targets.some((target) => this.isSelected(target));
  }

  private selectRow(row?: CursorRow) {
    this.selectedText = row?.textKey;
    this.selectedHeader = row?.header ? row.file : undefined;
    this.selected = row?.header
      ? undefined
      : (row?.targets.find((target) => target.side === this.preferredSide) ??
        row?.targets[0]);
  }

  get hasCursor() {
    return (
      this.cursorActive &&
      this.visibleCursorRows().some((row) => this.matchesCursor(row))
    );
  }

  cursorTargets() {
    return this.visibleCursorRows().map((row) => ({
      top: row.node.y,
      bottom: row.node.y + row.node.height,
      selected: this.cursorActive && this.matchesCursor(row),
      focus: (x?: number) => {
        this.selectRow(row);
        if (x !== undefined && row.targets.length > 1) {
          const side = x < row.node.x + row.node.width / 2 ? "old" : "new";
          const target = row.targets.find((target) => target.side === side);
          if (target) {
            this.selected = target;
            this.preferredSide = side;
          }
        }
        this.cursorActive = true;
        this.setTheme(this.palette);
      },
    }));
  }

  setCursorActive(active: boolean) {
    if (this.cursorActive === active) return;

    this.cursorActive = active;
    this.setTheme(this.palette);
  }

  focusCursor() {
    const row = this.visibleCursorRows()[0];
    if (!row) return false;

    this.selectRow(row);
    this.cursorActive = true;
    this.setTheme(this.palette);
    this.revealCursor();

    return true;
  }

  moveCursor(direction: number): boolean {
    const rows = this.visibleCursorRows();
    if (!rows.length) {
      this.selectRow();
      this.setTheme(this.palette);
      return false;
    }

    const current = rows.findIndex((row) => this.matchesCursor(row));
    const index =
      current < 0
        ? 0
        : Math.max(0, Math.min(rows.length - 1, current + direction));
    if (index === current) {
      this.revealCursor();
      return false;
    }
    this.selectRow(rows[index]);
    this.setTheme(this.palette);
    this.revealCursor();

    return true;
  }

  switchSide() {
    if (!this.cursorActive) return;

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
    const signal = this.controller.signal;
    this.body.afterLayout(() => {
      if (signal.aborted || this.isDestroyed || !this.cursorActive) return;

      const row = this.visibleCursorRows().find((row) =>
        this.matchesCursor(row),
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
  resizeLayout(columns?: number) {
    if (columns !== undefined) this.columns = columns;
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
    return Math.max(
      1,
      this.columns ?? (this.body.viewport.width || this.renderer.width - 3),
    );
  }

  private preserve(change: () => void) {
    const epoch = ++this.anchorEpoch;
    const top = this.body.viewport.y;
    const anchor = this.logical.find(
      ({ node, file, thread }) =>
        (!thread || this.expanded(thread)) &&
        (!this.collapsed.has(file) ||
          this.headers.some((header) => header.box === node)) &&
        node.y + node.height > top,
    );
    const oldY = anchor?.node.y;
    const scrollTop = this.body.scrollTop;

    change();
    if (
      !anchor ||
      oldY === undefined ||
      oldY >= this.body.viewport.y + this.body.viewport.height ||
      oldY > top
    )
      return;

    this.body.afterLayout(() => {
      if (epoch !== this.anchorEpoch || this.body.scrollTop !== scrollTop)
        return;

      const next = this.logical.find(
        (row) =>
          row.file === anchor.file &&
          (anchor.key
            ? row.key === anchor.key
            : !row.key &&
              row.sources.some((source) => anchor.sources.includes(source))),
      );
      if (next) this.body.scrollBy(next.node.y - oldY);
    });
  }

  toggleVisibleFile() {
    if (this.cursorActive && this.focusedRow?.thread) {
      this.toggleThread(this.focusedRow.thread);
      return true;
    }
    const selectedFile = this.cursorFile;
    if (this.cursorActive && selectedFile) {
      this.toggleFile(selectedFile);
      return true;
    }

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
    if (!header) return false;

    this.toggleFile(header.file.id);
    return true;
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
    if (this.cursorActive && this.cursorFile === id) {
      if (this.collapsed.has(id))
        this.selectRow(
          this.cursorRows.find((row) => row.header && row.file === id),
        );
      this.revealCursor();
    }
    this.setTheme(this.palette);
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
    const path = new SearchText(this.renderer, {
      content: name,
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      wrapMode: "char",
    });
    const added = new SearchText(this.renderer, {
      content: `+${file.additions ?? 0}`,
      attributes: TextAttributes.BOLD,
      flexShrink: 0,
    });
    const deleted = new SearchText(this.renderer, {
      content: `-${file.deletions ?? 0}`,
      attributes: TextAttributes.BOLD,
      flexShrink: 0,
    });

    for (const node of [button, path, added, deleted]) box.add(node);

    this.add(box);
    this.add(content);
    this.headers.push({ file, box, chevron, path, added, deleted, content });
    this.logical.push({ node: box, file: file.id, sources: [0] });
    const cursorRow: CursorRow = {
      node: box,
      file: file.id,
      targets: [],
      header: true,
    };
    this.cursorRows.push(cursorRow);
    for (const [label, node] of [
      ["path", path],
      ["added", added],
      ["deleted", deleted],
    ] as const)
      this.addSearchTarget(
        `${file.id}:header:${label}`,
        node,
        file.id,
        cursorRow,
      );

    return content;
  }

  private rebuild() {
    this.captureEditor();
    this.editor = undefined;
    for (const child of this.getChildren()) child.destroyRecursively();

    this.headers = [];
    this.painted = [];
    this.fills = [];
    this.cursorBoxes = [];
    this.logical = [];
    this.cursorRows = [];
    this.threadDetails = [];
    this.commentBoxes = [];
    this.commentText = [];
    this.searchEntries = [];
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
      for (const thread of this.commentState.threads.values()) {
        if (this.matchesThreadFile(thread, file) && thread.fileLevel)
          this.renderCommentBlock(
            content,
            {
              fileId: file.id,
              path: thread.path,
              side: thread.side,
              line: 1,
              replyTo: thread.id,
            },
            mode,
            thread,
          );
      }
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
        const paintedStart = this.painted.length;
        let node: BoxRenderable | TextRenderable;
        if (row.full) {
          const full = row.full;
          const text = full.text;
          node = new BoxRenderable(this.renderer, {
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          });
          const cell: DiffCell = {
            text: full.prefix ? text.slice(full.prefix.length) : text,
            prefix: full.prefix ?? "",
            role: full.role,
            line: full.line,
            side: full.role === "deletion" ? "old" : "new",
          };
          node.add(this.text(cell));
          this.cursorBoxes.push({ box: node, cell, file: file.id });
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
              this.cursorBoxes.push({
                box: pane,
                cell,
                file: file.id,
              });
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
          this.indexSearchRow(
            file,
            row.sources,
            paintedStart,
            this.cursorRows[this.cursorRows.length - 1],
          );
          this.renderComments(content, commentTargets, mode);
        } else {
          const text = this.painted
            .slice(paintedStart)
            .find(
              ({ cell }) => cell.role !== "marker" || cell.text.trim(),
            )?.node;
          const cursorRow: CursorRow = {
            node,
            file: file.id,
            targets: [],
            textKey: `${file.id}:marker:${row.sources.join(",")}`,
            text,
          };
          this.cursorRows.push(cursorRow);
          this.indexSearchRow(file, row.sources, paintedStart, cursorRow);
        }
      }
    });

    if (!this.visibleCursorRows().some((row) => this.matchesCursor(row))) {
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
      if (replacement) {
        this.selected = replacement;
        this.selectedHeader = undefined;
      } else this.selectRow(this.visibleCursorRows()[0]);
    }

    this.searchEntries.sort((left, right) => {
      for (
        let index = 0;
        index < Math.max(left.order.length, right.order.length);
        index++
      ) {
        const difference = (left.order[index] ?? 0) - (right.order[index] ?? 0);
        if (difference) return difference;
      }
      return 0;
    });
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
      this.renderCommentBlock(content, target, mode);
      for (const thread of this.commentState.threads.values()) {
        const file = this.files.find((file) => file.id === target.fileId);
        if (
          file &&
          this.matchesThreadFile(thread, file) &&
          !thread.fileLevel &&
          thread.side === target.side &&
          thread.line === target.line
        )
          this.renderCommentBlock(
            content,
            { ...target, replyTo: thread.id },
            mode,
            thread,
          );
      }
    }
  }

  private matchesThreadFile(thread: ReviewThread, file: FileRows) {
    return (
      !thread.outdated &&
      (thread.fileId
        ? thread.fileId === file.id
        : thread.path === file.newPath || thread.path === file.oldPath)
    );
  }

  private threadDetails: {
    thread: ReviewThread;
    box: BoxRenderable;
    frame: BoxRenderable;
    header: SearchText;
  }[] = [];

  private refreshThreadVisibility() {
    for (const { thread, box, frame, header } of this.threadDetails) {
      box.visible = this.expanded(thread);
      frame.border = box.visible;
      const label = `${box.visible ? "⌄" : "›"} \uf41f ${thread.comments.length} comments`;
      if (header.plainText !== label) header.content = label;
    }
  }

  private renderCommentBlock(
    content: BoxRenderable,
    target: CommentTarget,
    mode: "inline" | "side-by-side",
    thread?: ReviewThread,
  ) {
    const key = commentKey(target);
    const published = thread?.comments ?? [];
    const active = this.active && commentKey(this.active) === key;
    const draft = this.drafts.get(key);
    const status = draft?.pending || draft?.error;
    if (!thread && !active && !status) return;

    const row = new BoxRenderable(this.renderer, {
      width: "100%",
      flexDirection: "row",
      flexShrink: 0,
    });
    if (mode === "side-by-side") {
      row.add(new BoxRenderable(this.renderer, { flexGrow: 1, flexBasis: 0 }));
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
      border: !thread || this.expanded(thread),
      borderColor: this.palette.border,
      backgroundColor: this.palette.surface,
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.commentBoxes.push(box);
    let textIndex = 0;
    let parent = box;
    let threadBody = false;
    const commentLines = new Map<number, number>();
    const text = (
      value: string,
      searchable = true,
      comment?: PublishedComment,
      role?: string,
    ) => {
      const nodes: SearchText[] = [];
      for (const line of value.split("\n")) {
        const node = new SearchText(this.renderer, {
          content: line,
          width: "100%",
          minHeight: 1,
          wrapMode: "word",
          flexShrink: 0,
          fg: this.palette.text,
          bg: this.palette.surface,
        });
        this.commentText.push(node);
        parent.add(node);
        nodes.push(node);
        textIndex++;
        const commentLine = comment ? (commentLines.get(comment.id) ?? 0) : 0;
        if (comment) commentLines.set(comment.id, commentLine + 1);
        const textKey = role
          ? `comment:${key}:role:${role}`
          : comment
            ? `comment:${key}:${comment.id}:${commentLine}`
            : `comment:${key}:${textIndex}`;
        const cursorRow: CursorRow = {
          node,
          file: target.fileId,
          targets: [],
          textKey,
          text: node,
          thread,
          comment,
          threadBody,
        };
        node.onMouseDown = (event) => {
          if (event.button !== 0) return;

          event.stopPropagation();
          this.onFocus?.(() => {
            this.selectRow(cursorRow);
            this.setCursorActive(true);
            this.setTheme(this.palette);
          });
        };
        this.cursorRows.push(cursorRow);
        this.logical.push({
          node,
          file: target.fileId,
          sources: [],
          key: textKey,
          thread: threadBody ? thread : undefined,
        });
        if (searchable) {
          const source =
            this.files
              .find((file) => file.id === target.fileId)
              ?.rows.findIndex(
                ({ line }) =>
                  line &&
                  (target.side === "old" ? line.oldLine : line.newLine) ===
                    target.line,
              ) ?? 0;
          this.addSearchTarget(
            textKey,
            node,
            target.fileId,
            cursorRow,
            0,
            line,
            undefined,
            [source, 1, textIndex],
          );
        }
      }
      return nodes;
    };

    if (thread) {
      const [header] = text(
        `${this.expanded(thread) ? "⌄" : "›"} \uf41f ${published.length} comments`,
      );
      header.id = `thread-${thread.id}`;
      header.height = 1;
      header.wrapMode = "none";
      header.onMouseDown = (event) => {
        if (event.button !== 0) return;

        event.stopPropagation();
        const accepted = this.onFocus?.(() => {
          this.selectRow(
            this.cursorRows.find(
              (row) => row.thread === thread && !row.threadBody,
            ),
          );
          this.setCursorActive(true);
        });
        if (accepted !== false) this.toggleThread(thread);
      };
      parent = new BoxRenderable(this.renderer, {
        width: "100%",
        flexDirection: "column",
        flexShrink: 0,
        visible: this.expanded(thread),
      });
      box.add(parent);
      this.threadDetails.push({ thread, box: parent, frame: box, header });
      threadBody = true;
    }
    text(
      `${target.path} · ${target.side} ${thread?.fileLevel ? "file" : thread?.startLine ? (thread.startSide && thread.startSide !== target.side ? `range ${thread.startSide} ${thread.startLine}–${target.side} ${target.line}` : `lines ${thread.startLine}–${target.line}`) : `line ${target.line}`}${thread?.resolved ? " · Resolved" : ""}`,
    );
    for (const comment of published) {
      text(`${comment.author}: ${comment.body}\n${comment.url}`, true, comment);
      const reactions = new BoxRenderable(this.renderer, {
        width: "100%",
        flexDirection: "row",
        flexWrap: "wrap",
        flexShrink: 0,
        gap: 1,
      });
      parent.add(reactions);
      const button = (label: string, id: string, action: () => void) => {
        const node = new SearchText(this.renderer, {
          id,
          content: label,
          flexShrink: 0,
          onMouseDown: (event) => {
            if (event.button !== 0 || this.active) return;

            event.stopPropagation();
            const accepted = this.onFocus?.(() => {
              this.selectRow(
                this.cursorRows.find((row) => row.comment === comment),
              );
              this.setCursorActive(true);
              this.setTheme(this.palette);
            });
            if (accepted !== false) action();
          },
        });
        this.commentText.push(node);
        reactions.add(node);
      };
      for (const [content, icon] of reactionChoices) {
        const reaction = comment.reactions?.find(
          (item) => item.content === content,
        );
        if (reaction?.count)
          button(
            `${icon} ${reaction.count}${reaction.viewerHasReacted ? " ✓" : ""}`,
            `reaction-${comment.id}-${content}`,
            () => void toggleReaction(this.commentState, comment, content),
          );
      }
      button(
        `\uf4a2 ${actionKeys(this.bindings, "open_reactions", "viewer")[0] ?? "unbound"}`,
        `react-${comment.id}`,
        () => this.commentState.openReactions?.(comment),
      );
      if (this.commentState.reactionPending.has(comment.id))
        text("Updating reaction…", false, comment);
      const error = this.commentState.reactionErrors.get(comment.id);
      if (error) text(error, false, comment);
    }
    if (thread) {
      const [reply] = text(
        `Reply · ${actionKeys(this.bindings, "open_comment", "viewer").join("/") || "unbound"}`,
        false,
        undefined,
        "reply",
      );
      reply.id = `reply-${thread.id}`;
      reply.onMouseDown = (event) => {
        if (event.button !== 0 || this.active) return;

        event.stopPropagation();
        const accepted = this.onFocus?.(() => {
          this.selectRow(this.cursorRows.find((row) => row.thread === thread));
          this.setCursorActive(true);
        });
        if (accepted !== false) this.openComment();
      };
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
        parent.add(this.editor);
        text(
          draft.pending
            ? "Publishing…"
            : `${this.bindings.close_comment.join("/") || "unbound"}: close · ${this.bindings.publish_comment.join("/") || "unbound"}: publish`,
          false,
        );
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

  private text(cell: DiffCell, width: number | "100%" = "100%") {
    const node = new SearchText(this.renderer, {
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

    for (const { file, box, chevron, path, added, deleted } of this.headers) {
      const background =
        this.cursorActive && this.selectedHeader === file.id
          ? cursorBackground(theme.surface, theme.name)
          : theme.surface;
      box.backgroundColor = background;
      box.borderColor = theme.border;
      for (const node of [chevron, path, added, deleted]) node.bg = background;

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

    const selectedBoxes = this.cursorBoxes.filter(
      ({ cell, file }) =>
        this.cursorActive &&
        this.selected &&
        cell.line &&
        cell.side === this.selected.side &&
        file === this.selected.fileId &&
        (cell.side === "old" ? cell.line.oldLine : cell.line.newLine) ===
          this.selected.line,
    );
    for (const { box } of this.cursorBoxes) {
      const selected = selectedBoxes.some((entry) => entry.box === box);
      if (selected)
        box.backgroundColor = cursorBackground(box.backgroundColor, theme.name);
    }

    const selectedCells = new Set(selectedBoxes.map(({ cell }) => cell));
    for (const { node, cell } of this.painted) {
      const selected =
        selectedCells.has(cell) ||
        (this.cursorActive &&
          this.cursorRows.some(
            (row) => row.textKey === this.selectedText && row.text === node,
          ));
      const highlight = (background: string) =>
        selected ? cursorBackground(background, theme.name) : background;
      const changed = cell.role === "addition" || cell.role === "deletion";
      const pair = changed
        ? theme.diff[cell.role as "addition" | "deletion"]
        : undefined;
      const foreground = pair?.foreground ?? this.foreground(cell.role);
      const baseBackground = pair?.background ?? theme.diff.background;
      const background = highlight(baseBackground);
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
            highlight(
              cell.role === "addition" || cell.role === "deletion"
                ? diffGutterBackground(theme, cell.role)
                : theme.surface,
            ),
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
                  span.changed && pair
                    ? highlight(pair.spanBackground)
                    : background;

                return {
                  __isChunk: true as const,
                  text: span.text,
                  fg: RGBA.fromHex(
                    readableTokenColor(
                      span.color,
                      foreground,
                      span.changed && pair
                        ? pair.spanBackground
                        : baseBackground,
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
      box.borderColor = theme.border;
      box.backgroundColor = theme.surface;
    }
    this.refreshThreadVisibility();
    for (const node of this.commentText) {
      node.fg = theme.text;
      node.bg =
        this.cursorActive &&
        this.cursorRows.some(
          (row) => row.textKey === this.selectedText && row.text === node,
        )
          ? cursorBackground(theme.surface, theme.name)
          : theme.surface;
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
