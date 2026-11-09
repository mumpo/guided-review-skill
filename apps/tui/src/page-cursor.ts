import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { CursorText } from "./cursor-text";
import type { DiffView } from "./diff-view";

interface NarrativeLine {
  node: CursorText;
  line: number;
}

/** One keyboard cursor crosses narrative and captured source without mixing targets. */
export class PageCursor {
  private selected?: NarrativeLine;
  private inDiff = false;
  private indexHint = 0;
  private epoch = 0;

  constructor(
    private body: ScrollBoxRenderable,
    private roots: Renderable[],
    private changes: DiffView,
  ) {}

  reset() {
    this.epoch++;
    this.clearText();
    this.inDiff = false;
    this.indexHint = 0;
    this.changes.setCursorActive(false);

    const first = this.lines()[0];
    if (first) this.selectText(first);
    else this.inDiff = this.changes.focusCursor();
  }

  deactivate() {
    this.epoch++;
    this.clearText();
    this.inDiff = false;
    this.changes.setCursorActive(false);
  }

  get fileId() {
    return this.inDiff ? this.changes.cursorFile : undefined;
  }

  targets() {
    return [
      ...this.lines().map(({ node, line }) => ({
        ...node.lineBounds(line),
        selected: !this.inDiff && this.matches({ node, line }),
        focus: (_x?: number) => this.focusText(node, line),
      })),
      ...this.changes.cursorTargets().map((target) => ({
        ...target,
        focus: (x?: number) => this.focusDiff(() => target.focus(x)),
      })),
    ];
  }

  focusText(node: CursorText, line: number) {
    this.epoch++;
    this.selectText({ node, line });
  }

  focusDiff(focus: () => void) {
    this.epoch++;
    this.clearText();
    this.inDiff = true;
    focus();
  }

  focusFile(id: string) {
    this.clearText();
    this.inDiff = this.changes.focusFile(id);
  }

  focusLast() {
    this.clearText();
    if (this.changes.focusLastCursor()) this.inDiff = true;
    else {
      const lines = this.lines();
      if (lines.length) this.selectText(lines[lines.length - 1]);
    }
  }

  move(direction: number): boolean {
    const lines = this.lines();
    if (this.inDiff) {
      if (this.changes.moveCursor(direction)) return true;
      if (direction < 0 && lines.length) {
        this.selectText(lines[lines.length - 1]);
        this.revealText();
        return true;
      }
      return false;
    }

    const current = lines.findIndex((entry) => this.matches(entry));
    const next =
      current < 0
        ? Math.min(this.indexHint, lines.length - 1)
        : current + direction;

    if (next >= lines.length) {
      if (this.changes.focusCursor()) {
        this.clearText();
        this.inDiff = true;
        return true;
      }
    } else if (next >= 0) {
      this.selectText(lines[next]);
      this.revealText();
      return true;
    }
    return false;
  }

  /** Mermaid fallback replacement or collapsing all files may remove a target. */
  refresh() {
    const lines = this.lines();
    if (this.inDiff) {
      if (!this.changes.hasCursor && lines.length)
        this.selectText(lines[lines.length - 1]);
    } else if (!this.selected || !lines.some((entry) => this.matches(entry))) {
      const next = lines[Math.min(this.indexHint, lines.length - 1)];
      if (next) this.selectText(next);
      else {
        this.clearText();
        this.inDiff = this.changes.focusCursor();
      }
    }
  }

  private matches(entry: NarrativeLine) {
    return (
      entry.node === this.selected?.node && entry.line === this.selected.line
    );
  }

  private lines(): NarrativeLine[] {
    const result: NarrativeLine[] = [];
    const walk = (node: Renderable) => {
      if (!node.visible || node.isDestroyed) return;

      if (node instanceof CursorText) {
        result.push(...node.cursorLines().map((line) => ({ node, line })));
      }
      for (const child of node.getChildren()) walk(child);
    };

    for (const root of this.roots) walk(root);

    return result;
  }

  private clearText() {
    this.selected?.node.setCursorLine();
    this.selected = undefined;
  }

  private selectText(entry: NarrativeLine) {
    this.clearText();
    this.inDiff = false;
    this.changes.setCursorActive(false);

    this.selected = entry;
    this.indexHint = this.lines().findIndex((line) => this.matches(line));
    entry.node.setCursorLine(entry.line);
  }

  private revealText() {
    const epoch = this.epoch;
    this.body.afterLayout(() => {
      const selected = this.selected;
      if (
        epoch !== this.epoch ||
        !selected ||
        selected.node.isDestroyed ||
        this.body.isDestroyed
      )
        return;

      const { top, bottom } = selected.node.lineBounds(selected.line);
      const viewport = this.body.viewport;
      if (top < viewport.y) this.body.scrollBy(top - viewport.y);
      else if (bottom > viewport.y + viewport.height) {
        this.body.scrollBy(
          Math.min(bottom - viewport.y - viewport.height, top - viewport.y),
        );
      }
    });
  }
}
