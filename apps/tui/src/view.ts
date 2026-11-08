import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  type Renderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { LoadedReview } from "./load";
import { type DiffMode, sectionDiffRows } from "./diff";
import { createCommentState, DiffView } from "./diff-view";
import { ExplanationView } from "./explanation-view";
import { MarkdownView } from "./markdown-view";
import { sessionHighlights } from "./highlight-service";
import { reviewSyntaxSamples } from "./highlight-preload";
import { type Theme, themes } from "./theme";
import { PullRequestHeader } from "./pr-header";
import { githubCommentPublisher, type PublishComment } from "./comments";
import { CursorText } from "./cursor-text";
import { PageCursor } from "./page-cursor";
import {
  keyAction,
  actionKeys,
  resolveKeybindings,
  type Keybindings,
} from "../../../packages/preferences/src/keybindings";

interface DocumentPart {
  title: string;
  root: BoxRenderable;
  narrative: BoxRenderable;
  changes: DiffView;
  explanation?: ExplanationView;
  cursor: PageCursor;
  target: Renderable;
}

interface NavigationEntry {
  part: number;
  file?: string;
  label: string;
  icon: string;
  row: TextRenderable;
}

/** A summary and all captured sections share one document and one cursor. */
export function mountReview(
  renderer: CliRenderer,
  review: LoadedReview,
  theme: Theme = themes["github-dark"],
  diffMode: DiffMode = "auto",
  publish?: PublishComment,
  bindings: Keybindings = resolveKeybindings(),
): (theme: Theme) => void {
  const { snapshot, analysis } = review;
  const pr = snapshot.pullRequest;
  const commentController = new AbortController();
  const publisher =
    publish ?? githubCommentPublisher(pr, undefined, commentController.signal);
  const commentState = createCommentState();
  const parts: DocumentPart[] = [];
  const entries: NavigationEntry[] = [];
  const texts: CursorText[] = [];
  const markdowns: MarkdownView[] = [];
  const separators: BoxRenderable[] = [];
  let active = 0;
  let selectedEntry = -1;
  let sidebarOverride: boolean | undefined;
  let navigationEpoch = 0;

  const root = new BoxRenderable(renderer, {
    id: "review",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const heading = new TextRenderable(renderer, {
    id: "heading",
    content: "",
    wrapMode: "word",
    flexShrink: 0,
  });
  const workspace = new BoxRenderable(renderer, {
    id: "workspace",
    width: "100%",
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "row",
  });
  const sidebar = new ScrollBoxRenderable(renderer, {
    id: "sidebar",
    width: 32,
    flexShrink: 0,
    minHeight: 0,
    scrollX: false,
    scrollY: true,
    border: ["right"],
    contentOptions: { flexDirection: "column" },
  });
  const body = new ScrollBoxRenderable(renderer, {
    id: "body",
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    scrollX: false,
    scrollY: true,
    contentOptions: { flexDirection: "column" },
  });
  const help = new TextRenderable(renderer, {
    id: "help",
    content: "",
    wrapMode: "none",
    height: 3,
    flexShrink: 0,
  });
  workspace.add(sidebar);
  workspace.add(body);
  root.add(heading);
  root.add(workspace);
  root.add(help);
  renderer.root.add(root);

  function separator(parent: BoxRenderable, id?: string) {
    const node = new BoxRenderable(renderer, {
      id,
      width: "100%",
      height: 1,
      flexShrink: 0,
      border: ["top"],
      marginBottom: 1,
    });
    parent.add(node);
    separators.push(node);
  }

  function plain(parent: BoxRenderable, content: string) {
    const node = new CursorText(renderer, {
      content,
      width: "100%",
      wrapMode: "word",
      flexShrink: 0,
      marginBottom: 1,
    });
    node.setCursorTheme(theme.name);
    parent.add(node);
    texts.push(node);
    return node;
  }

  function addEntry(part: number, label: string, icon = "", file?: string) {
    const index = entries.length;
    const row = new TextRenderable(renderer, {
      id: `navigation-${index}`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (!parts.some((part) => part.changes.editing)) jump(index);
      },
    });
    sidebar.add(row);
    entries.push({ part, file, label, icon, row });
  }

  const icons = {
    added: "\uf457",
    modified: "\uf459",
    renamed: "\uf45a",
    deleted: "\uf458",
  };
  const statusById = new Map(
    snapshot.files.map((file) => [file.id, file.status]),
  );
  let prHeader: PullRequestHeader;
  for (let index = 0; index <= snapshot.sections.length; index++) {
    const section = snapshot.sections[index - 1];
    const container = new BoxRenderable(renderer, {
      id: `section-${index}`,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
    });
    body.add(container);
    if (index > 0) separator(container, `section-separator-${index}`);
    const narrative = new BoxRenderable(renderer, {
      id: `narrative-${index}`,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
    });
    container.add(narrative);
    let target: Renderable;
    let explanation: ExplanationView | undefined;
    if (index === 0) {
      prHeader = new PullRequestHeader(renderer, pr, theme);
      narrative.add(prHeader);
      const limits = snapshot.files
        .filter((file) => file.diff.kind !== "text")
        .map(
          (file) =>
            `${file.newPath ?? file.oldPath}: ${file.diff.kind === "unavailable" ? `unavailable (${file.diff.reason})` : "binary"}`,
        );
      target = plain(
        narrative,
        [
          `${pr.url}\nBase: ${pr.baseCommit}\nHead: ${pr.headCommit}`,
          `${snapshot.files.length} files · ${snapshot.sections.length} sections`,
          ...(analysis.uncovered.length
            ? [
                `Coverage: ${analysis.uncovered.length} file(s) have changes or markers outside the walkthrough.`,
              ]
            : []),
          ...(limits.length ? [`Diff limits:\n${limits.join("\n")}`] : []),
        ].join("\n\n"),
      );
      separator(narrative, "description-separator");
      const description = new MarkdownView(renderer, theme);
      description.marginBottom = 1;
      description.setContent(pr.description || "(No description)");
      narrative.add(description);
      markdowns.push(description);
    } else {
      target = plain(narrative, section.title);
      explanation = new ExplanationView(
        renderer,
        body,
        theme,
        undefined,
        false,
      );
      explanation.id = `explanation-${index}`;
      container.add(explanation);
      explanation.setContent(section.explanation || "(No explanation)");
    }
    const changes = new DiffView(
      renderer,
      body,
      theme,
      sessionHighlights(renderer),
      publisher,
      bindings,
      commentState,
    );
    changes.id = `changes-${index}`;
    changes.setCursorActive(false);
    container.add(changes);
    const files =
      index === 0 ? [] : sectionDiffRows(analysis.sections[index - 1]);
    changes.setFiles(
      index > 0 && !files.length
        ? [
            {
              id: "empty",
              width: 3,
              rows: [{ text: "(No referenced changes)", role: "marker" }],
            },
          ]
        : files,
      diffMode,
    );
    const cursor = new PageCursor(
      body,
      explanation ? [narrative, explanation] : [narrative],
      changes,
    );
    parts.push({
      title: index === 0 ? "Summary" : section.title,
      root: container,
      narrative,
      changes,
      explanation,
      cursor,
      target,
    });
    addEntry(index, index === 0 ? "Summary" : `${index}. ${section.title}`);
    for (const file of files)
      addEntry(
        index,
        file.newPath ?? file.oldPath ?? file.id,
        icons[statusById.get(file.id) ?? "modified"],
        file.id,
      );
  }

  function updateHelp() {
    const label = (action: keyof Keybindings) =>
      actionKeys(bindings, action, "viewer").join("/") || "unbound";
    help.content = `${label("next_section")}/${label("previous_section")}: sections | ${label("next_item")}/${label("previous_item")}: items | ${label("toggle_sidebar")}: sidebar | ${label("quit")}/${label("interrupt")}: quit\n${label("cursor_down")}/${label("cursor_up")}: cursor | ${label("switch_side")}: side | ${label("open_comment")}: comment | ${label("toggle_file")}: fold | ${label("cycle_diff_mode")}: diff ${diffMode}\n${label("scroll_up")}/${label("scroll_down")}: scroll | ${label("page_up")}/${label("page_down")}: page | ${label("half_page_up")}/${label("half_page_down")}: half page`;
  }

  function paintSidebar(force = false) {
    const file = parts[active].cursor.fileId;
    const index = entries.findIndex(
      (entry) => entry.part === active && entry.file === file,
    );
    const changed = index !== selectedEntry;
    if (!changed && !force) return;
    selectedEntry = index;
    heading.content = `${pr.owner}/${pr.repository} #${pr.number} · ${active === 0 ? "Summary" : `Section ${active}/${snapshot.sections.length}: ${parts[active].title}`}\n`;
    for (const [i, entry] of entries.entries()) {
      entry.row.fg = i === index ? theme.navigation.foreground : theme.text;
      entry.row.bg =
        i === index ? theme.navigation.background : theme.background;
    }
    if ((changed || force) && sidebar.visible) {
      const row = entries[index]?.row;
      if (row)
        sidebar.afterLayout(() => {
          if (sidebar.isDestroyed || selectedEntry !== index) return;
          if (row.y < sidebar.viewport.y)
            sidebar.scrollBy(row.y - sidebar.viewport.y);
          else if (
            row.y + row.height >
            sidebar.viewport.y + sidebar.viewport.height
          )
            sidebar.scrollBy(
              row.y + row.height - sidebar.viewport.y - sidebar.viewport.height,
            );
        });
    }
  }

  function jump(index: number) {
    const entry = entries[Math.max(0, Math.min(entries.length - 1, index))];
    const epoch = ++navigationEpoch;
    parts[active].cursor.deactivate();
    active = entry.part;
    const part = parts[active];
    if (entry.file) part.cursor.focusFile(entry.file);
    else part.cursor.reset();
    paintSidebar();
    body.afterLayout(() => {
      if (body.isDestroyed || epoch !== navigationEpoch) return;
      const node = entry.file
        ? part.changes.fileHeaderNode(entry.file)
        : part.target;
      if (active === 0 && !entry.file) body.scrollTo(0);
      else if (node) body.scrollBy(node.y - body.viewport.y);
    });
  }

  function anchorViewport() {
    const top = body.viewport.y;
    let anchor: Renderable | undefined;
    const visit = (parent: Renderable) => {
      for (const child of parent.getChildren()) {
        if (
          !child.visible ||
          child.isDestroyed ||
          child.y > top ||
          child.y + child.height <= top
        )
          continue;
        anchor = child;
        visit(child);
        break;
      }
    };
    visit(body);
    return anchor ? body.anchor(anchor) : () => {};
  }

  function updateGeometry() {
    const release = anchorViewport();
    sidebar.visible = sidebarOverride ?? renderer.width >= 110;
    const width = Math.min(32, Math.max(1, Math.floor(renderer.width * 0.4)));
    sidebar.width = width;
    for (const entry of entries) {
      const prefix = entry.file ? `  ${entry.icon} ` : "";
      const max = Math.max(1, width - 2 - displayWidth(prefix));
      entry.row.content = prefix + truncate(entry.label, max, !!entry.file);
    }
    for (const part of parts) {
      part.changes.resizeLayout(
        Math.max(1, renderer.width - 3 - (sidebar.visible ? width : 0)),
      );
      part.explanation?.resizeLayout();
    }
    body.afterLayout(() => {
      release();
      if (!body.isDestroyed) paintSidebar(true);
    });
  }

  function applyTheme(next: Theme) {
    theme = next;
    renderer.setBackgroundColor(theme.background);
    root.backgroundColor = theme.background;
    heading.fg = theme.navigation.foreground;
    heading.bg = theme.navigation.background;
    help.fg = theme.muted;
    help.bg = theme.surface;
    sidebar.borderColor = theme.muted;
    for (const node of texts) {
      node.setCursorTheme(theme.name);
      node.fg = theme.markdown.text;
      node.bg = theme.background;
    }
    for (const node of markdowns) node.setTheme(theme);
    prHeader.setTheme(theme);
    for (const node of separators) {
      node.borderColor = theme.muted;
      node.backgroundColor = theme.background;
    }
    for (const part of parts) {
      part.root.backgroundColor = theme.background;
      part.narrative.backgroundColor = theme.background;
      part.explanation?.setTheme(theme);
      part.changes.setTheme(theme);
    }
    for (const scroll of [body, sidebar]) {
      scroll.backgroundColor = theme.background;
      scroll.scrollbarOptions = {
        trackOptions: {
          foregroundColor: theme.scrollbar.foreground,
          backgroundColor: theme.scrollbar.background,
        },
        arrowOptions: {
          foregroundColor: theme.scrollbar.foreground,
          backgroundColor: theme.scrollbar.background,
        },
      };
    }
    paintSidebar(true);
  }

  function onKey(key: KeyEvent) {
    const editor = parts.find((part) => part.changes.editing)?.changes;
    const action = keyAction(bindings, key, editor ? "editor" : "viewer");
    if (action === "interrupt") {
      key.preventDefault();
      renderer.destroy();
      return;
    }
    if (editor?.handleCommentKey(key)) return;
    if (!action) return;
    const part = parts[active];
    switch (action) {
      case "quit":
        renderer.destroy();
        break;
      case "next_section":
      case "previous_section": {
        const next = Math.max(
          0,
          Math.min(
            parts.length - 1,
            active + (action === "next_section" ? 1 : -1),
          ),
        );
        if (next !== active)
          jump(
            entries.findIndex((entry) => entry.part === next && !entry.file),
          );
        break;
      }
      case "next_item":
        jump(selectedEntry + 1);
        break;
      case "previous_item":
        jump(selectedEntry - 1);
        break;
      case "summary":
        jump(0);
        break;
      case "last_section":
        jump(
          entries.findIndex(
            (entry) => entry.part === parts.length - 1 && !entry.file,
          ),
        );
        break;
      case "cursor_down":
      case "cursor_up": {
        const direction = action === "cursor_down" ? 1 : -1;
        if (!part.cursor.move(direction)) {
          const next = active + direction;
          if (next >= 0 && next < parts.length) {
            part.cursor.deactivate();
            active = next;
            if (direction > 0) parts[active].cursor.reset();
            else parts[active].cursor.focusLast();
            // A reset selects the first line without scrolling on its own.
            if (direction > 0)
              body.afterLayout(() => {
                const target = parts[active].target;
                if (
                  !body.isDestroyed &&
                  target.y >= body.viewport.y + body.viewport.height
                )
                  body.scrollBy(
                    target.y - body.viewport.y - body.viewport.height + 1,
                  );
              });
          }
        }
        paintSidebar();
        break;
      }
      case "scroll_down":
        body.scrollBy(1);
        break;
      case "scroll_up":
        body.scrollBy(-1);
        break;
      case "page_down":
        body.scrollBy(Math.max(1, body.viewport.height - 1));
        break;
      case "page_up":
        body.scrollBy(-Math.max(1, body.viewport.height - 1));
        break;
      case "half_page_down":
        body.scrollBy(Math.max(1, Math.floor(body.viewport.height / 2)));
        break;
      case "half_page_up":
        body.scrollBy(-Math.max(1, Math.floor(body.viewport.height / 2)));
        break;
      case "open_comment":
        part.changes.openComment();
        break;
      case "switch_side":
        part.changes.switchSide();
        break;
      case "toggle_file": {
        if (part.cursor.fileId) part.changes.toggleVisibleFile();
        else
          for (const part of parts) {
            if (part.changes.toggleVisibleFile()) break;
          }
        break;
      }
      case "cycle_diff_mode": {
        const modes: DiffMode[] = ["auto", "inline", "side-by-side"];
        diffMode = modes[(modes.indexOf(diffMode) + 1) % modes.length];
        for (const part of parts) part.changes.setMode(diffMode);
        updateHelp();
        break;
      }
      case "toggle_sidebar": {
        sidebarOverride = !sidebar.visible;
        updateGeometry();
        break;
      }
    }
    key.preventDefault();
  }

  const onPaste = (event: PasteEvent) =>
    parts
      .find((part) => part.changes.editing)
      ?.changes.handleCommentPaste(event);
  const onFrame = () => {
    for (const part of parts) part.explanation?.checkGeometry();
    parts[active].cursor.refresh();
    paintSidebar();
  };
  const onCapabilities = () => {
    for (const part of parts) part.explanation?.resizeLayout();
  };
  renderer.keyInput.on("keypress", onKey);
  renderer.keyInput.on("paste", onPaste);
  renderer.on("resize", updateGeometry);
  renderer.on("capabilities", onCapabilities);
  renderer.on("frame", onFrame);
  renderer.once("destroy", () => {
    commentController.abort();
    renderer.keyInput.off("keypress", onKey);
    renderer.keyInput.off("paste", onPaste);
    renderer.off("resize", updateGeometry);
    renderer.off("capabilities", onCapabilities);
    renderer.off("frame", onFrame);
  });
  parts[0].cursor.reset();
  updateHelp();
  updateGeometry();
  applyTheme(theme);
  sessionHighlights(renderer).preload(reviewSyntaxSamples(review));
  return applyTheme;
}

function displayWidth(text: string) {
  return Bun.stringWidth(text);
}

function truncate(text: string, width: number, fromLeft: boolean) {
  if (displayWidth(text) <= width) return text;

  const marker = ".".repeat(Math.min(3, width));
  const chars = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment,
  );
  if (fromLeft) chars.reverse();

  const selected: string[] = [];
  let remaining = width - marker.length;
  for (const char of chars) {
    const cells = displayWidth(char);
    if (cells > remaining) break;
    selected.push(char);
    remaining -= cells;
  }

  return fromLeft
    ? marker + selected.reverse().join("")
    : selected.join("") + marker;
}
