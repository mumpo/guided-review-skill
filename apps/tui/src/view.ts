import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
  StyledText,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  type Renderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextAttributes,
} from "@opentui/core";
import type { LoadedReview } from "./load";
import { type DiffMode, sectionDiffRows } from "./diff";
import { createCommentState, notifyComments, DiffView } from "./diff-view";
import { ExplanationView } from "./explanation-view";
import { MarkdownView } from "./markdown-view";
import { sessionHighlights } from "./highlight-service";
import { reviewSyntaxSamples } from "./highlight-preload";
import { type Theme, themes } from "./theme";
import { PullRequestHeader } from "./pr-header";
import {
  githubCommentPublisher,
  type PublishComment,
  type ThreadService,
} from "./comments";
import { githubThreadService } from "./threads";
import { ReactionPicker } from "./reaction-picker";
import { CursorText } from "./cursor-text";
import { cursorBackground } from "./cursor-highlight";
import { DocumentSearch, SearchText, type SearchTarget } from "./search";
import { PageCursor } from "./page-cursor";
import {
  keyAction,
  actionKeys,
  resolveKeybindings,
  type Keybindings,
  type KeyContext,
} from "../../../packages/preferences/src/keybindings";

interface DocumentPart {
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
  status?: keyof Theme["fileStatus"];
  display: string;
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
  options: {
    commentsUnfolded?: boolean;
    threads?: ThreadService;
    loadThreads?: boolean;
  } = {},
): (theme: Theme) => void {
  const { snapshot, analysis } = review;
  const pr = snapshot.pullRequest;
  const commentController = new AbortController();
  const publisher =
    publish ?? githubCommentPublisher(pr, undefined, commentController.signal);
  const threadService =
    options.threads ??
    (options.loadThreads
      ? githubThreadService(pr, undefined, commentController.signal)
      : undefined);
  const commentState = createCommentState(
    options.commentsUnfolded,
    threadService,
  );
  const reactionPicker = new ReactionPicker(
    renderer,
    commentState,
    bindings,
    theme,
  );
  commentState.openReactions = (comment) => {
    if (parts.some((part) => part.changes.editing)) return;

    reactionPicker.open(comment);
  };
  const parts: DocumentPart[] = [];
  const entries: NavigationEntry[] = [];
  const texts: CursorText[] = [];
  const markdowns: MarkdownView[] = [];
  const separators: BoxRenderable[] = [];
  let active = 0;
  let selectedEntry = -1;
  let sidebarOverride: boolean | undefined;
  let navigationEpoch = 0;
  let scrollEpoch = 0;

  const root = new BoxRenderable(renderer, {
    id: "review",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const search = new DocumentSearch();
  let searchRevision = -1;
  let searchState: "inactive" | "editing" | "committed" = "inactive";
  const searchBar = new BoxRenderable(renderer, {
    id: "search-bar",
    width: "100%",
    flexShrink: 0,
    flexDirection: "column",
    visible: false,
  });
  const searchRow = new BoxRenderable(renderer, {
    width: "100%",
    height: 1,
    flexDirection: "row",
  });
  const searchPrompt = new TextRenderable(renderer, { content: "/", width: 1 });
  const searchInput = new InputRenderable(renderer, {
    id: "search-input",
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    placeholder: "Search (\\c ignores case)",
  });
  const searchQuery = new TextRenderable(renderer, {
    id: "search-query",
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 1,
    truncate: true,
    visible: false,
  });
  const searchCount = new TextRenderable(renderer, {
    id: "search-count",
    flexShrink: 0,
  });
  searchRow.add(searchPrompt);
  searchRow.add(searchInput);
  searchRow.add(searchQuery);
  searchRow.add(searchCount);
  searchBar.add(searchRow);
  separator(searchBar, "search-separator", 0);
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
    wrapMode: "word",
    flexShrink: 0,
  });
  workspace.add(sidebar);
  workspace.add(body);
  root.add(searchBar);
  root.add(workspace);
  const keybindingsOverlay = new BoxRenderable(renderer, {
    id: "keybindings-overlay",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    zIndex: 10,
    visible: false,
    onMouseDown: (event) => event.stopPropagation(),
  });
  const keybindingsModal = new BoxRenderable(renderer, {
    id: "keybindings-modal",
    position: "absolute",
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    title: " Keybindings ",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const keybindingsPanel = new ScrollBoxRenderable(renderer, {
    id: "keybindings-panel",
    flexGrow: 1,
    minHeight: 0,
    scrollX: false,
    scrollY: true,
  });
  const keybindingsText = new TextRenderable(renderer, {
    id: "keybindings-text",
    wrapMode: "word",
    flexShrink: 0,
  });
  keybindingsPanel.add(keybindingsText);
  const keybindingsHint = new TextRenderable(renderer, {
    id: "keybindings-hint",
    content: "↑/↓ or j/k scroll  pgup/pgdn page  esc close",
    wrapMode: "word",
    flexShrink: 0,
  });
  keybindingsModal.add(keybindingsPanel);
  keybindingsModal.add(keybindingsHint);
  keybindingsOverlay.add(keybindingsModal);
  separator(root, "footer-separator", 0);
  root.add(help);
  renderer.root.add(root);
  renderer.root.add(keybindingsOverlay);

  function separator(parent: BoxRenderable, id?: string, marginBottom = 1) {
    const node = new BoxRenderable(renderer, {
      id,
      width: "100%",
      height: 1,
      flexShrink: 0,
      border: ["top"],
      marginBottom,
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

  function addEntry(
    part: number,
    label: string,
    icon = "",
    file?: string,
    status?: keyof Theme["fileStatus"],
  ) {
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
    entries.push({ part, file, label, icon, status, display: label, row });
  }

  const icons = {
    added: "\uf4d0",
    modified: "\uf4d2",
    renamed: "\uf4d5",
    deleted: "\uf4d6",
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
      (target as CursorText).content = new StyledText([
        {
          __isChunk: true,
          text: section.title,
          attributes: TextAttributes.BOLD,
        },
      ]);
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
      root: container,
      narrative,
      changes,
      explanation,
      cursor,
      target,
    });
    if (index > 0) separator(sidebar, `sidebar-separator-${index}`, 0);
    addEntry(
      index,
      index === 0 ? "Summary" : section.title,
      index === 0 ? "" : "\uf51e",
    );
    for (const file of files)
      addEntry(
        index,
        file.newPath ?? file.oldPath ?? file.id,
        icons[statusById.get(file.id) ?? "modified"],
        file.id,
        statusById.get(file.id) ?? "modified",
      );
  }

  for (const [index, part] of parts.entries()) {
    part.changes.onFocus = (focus) => {
      if (
        parts.some((part) => part.changes.editing) ||
        reactionPicker.overlay.visible ||
        searchState === "editing"
      )
        return false;

      parts[active].cursor.deactivate();
      active = index;
      part.cursor.focusDiff(focus);
      paintSidebar();
      return true;
    };
  }

  const threadStatus = plain(parts[0].narrative, "");
  threadStatus.id = "thread-load-status";
  threadStatus.visible = !!threadService;
  if (threadService) {
    threadStatus.content = "Loading review threads…";
    void threadService
      .load()
      .then((threads) => {
        if (commentController.signal.aborted) return;

        for (const thread of threads) {
          const paths = snapshot.files.filter(
            (file) => file.newPath === thread.path,
          );
          const candidates = paths.length
            ? paths
            : snapshot.files.filter((file) => file.oldPath === thread.path);
          if (candidates.length !== 1) continue;

          thread.fileId = candidates[0].id;
          const local = [...commentState.threads.values()].find(
            (current) =>
              current.id === thread.id ||
              (current.id.startsWith("local:") &&
                current.comments[0]?.id === thread.comments[0]?.id),
          );
          if (local) {
            // Keep local identities/drafts stable if a write completed during loading.
            local.comments = [
              ...new Map(
                [...thread.comments, ...local.comments].map((comment) => [
                  comment.id,
                  comment,
                ]),
              ).values(),
            ];
          } else commentState.threads.set(thread.id, thread);
        }
        threadStatus.visible = false;
        notifyComments(commentState);
      })
      .catch((error) => {
        if (commentController.signal.aborted) return;

        threadStatus.content = `Could not load review threads: ${error instanceof Error ? error.message : String(error)}`;
      });
  }

  function updateHelp() {
    const label = (action: keyof Keybindings, context: KeyContext = "viewer") =>
      actionKeys(bindings, action, context)
        .map((key) => key.replaceAll("ctrl+", "^"))
        .join("/") || "unbound";
    const descriptions: Record<keyof Keybindings, string> = {
      cursor_down: "move down",
      cursor_up: "move up",
      next_section: "next section",
      previous_section: "prev section",
      next_item: "next item",
      previous_item: "prev item",
      toggle_help: "keybindings",
      summary: "summary",
      last_section: "last section",
      scroll_down: "scroll down",
      scroll_up: "scroll up",
      page_down: "page down",
      page_up: "page up",
      half_page_down: "half page down",
      half_page_up: "half page up",
      switch_side: "switch diff side",
      open_comment: "new comment / reply",
      open_reactions: "react to comment",
      close_reactions: "close reactions",
      toggle_file: "fold/unfold thread or file",
      cycle_diff_mode: `cycle diff layout (${diffMode})`,
      toggle_sidebar: "toggle sidebar",
      quit: "quit",
      interrupt: "interrupt/quit",
      close_comment: "close comment editor",
      publish_comment: "publish comment",
      open_search: "search",
      clear_search: "clear search",
      submit_search: "commit search",
      next_match: "next match",
      previous_match: "previous match",
    };
    const chunk = (text: string, color: string) => ({
      __isChunk: true as const,
      text,
      fg: RGBA.fromHex(color),
    });
    const footerActions = [
      "cursor_down",
      "cursor_up",
      "next_section",
      "previous_section",
      "next_item",
      "previous_item",
      "open_search",
      "toggle_help",
    ] as const;
    help.content = new StyledText(
      footerActions.flatMap((action, index) => [
        chunk(`${index ? "  " : ""}${label(action)}`, theme.text),
        chunk(` ${descriptions[action]}`, theme.muted),
      ]),
    );

    const groups: {
      title: string;
      actions: (keyof Keybindings)[];
      context?: KeyContext;
    }[] = [
      {
        title: "Navigation",
        actions: [
          "cursor_down",
          "cursor_up",
          "next_section",
          "previous_section",
          "next_item",
          "previous_item",
          "summary",
          "last_section",
        ],
      },
      {
        title: "Scrolling",
        actions: [
          "scroll_down",
          "scroll_up",
          "page_down",
          "page_up",
          "half_page_down",
          "half_page_up",
        ],
      },
      {
        title: "Diff and comments",
        actions: [
          "switch_side",
          "open_comment",
          "open_reactions",
          "toggle_file",
          "cycle_diff_mode",
        ],
      },
      {
        title: "Search",
        actions: [
          "open_search",
          "next_match",
          "previous_match",
          "clear_search",
        ],
      },
      {
        title: "Search input",
        actions: ["submit_search", "clear_search", "interrupt"],
        context: "search",
      },
      {
        title: "Application",
        actions: ["toggle_sidebar", "toggle_help", "quit", "interrupt"],
      },
      {
        title: "Reaction picker",
        actions: ["close_reactions", "interrupt"],
        context: "reactions",
      },
      {
        title: "Comment editor",
        actions: ["close_comment", "publish_comment", "interrupt"],
        context: "editor",
      },
    ];
    const columnWidth = Math.max(
      12,
      ...groups.flatMap((group) =>
        group.actions.map(
          (action) =>
            displayWidth(label(action, group.context ?? "viewer")) + 2,
        ),
      ),
    );
    const narrow = Math.min(88, renderer.width - 4) - 4 < columnWidth + 24;
    keybindingsText.content = new StyledText(
      groups.flatMap((group, index) => [
        chunk(
          `${index ? "\n" : ""}${group.title}\n`,
          theme.navigation.foreground,
        ),
        ...group.actions.flatMap((action) => {
          const key = label(action, group.context ?? "viewer");
          return [
            chunk(`  ${key}`, theme.text),
            chunk(
              `${narrow ? "\n    " : " ".repeat(columnWidth - displayWidth(key))}${descriptions[action]}\n`,
              theme.muted,
            ),
          ];
        }),
      ]),
    );
  }

  function paintSidebar(force = false) {
    const file = parts[active].cursor.fileId;
    const index = entries.findIndex(
      (entry) => entry.part === active && entry.file === file,
    );
    const changed = index !== selectedEntry;
    if (!changed && !force) return;
    selectedEntry = index;
    for (const [i, entry] of entries.entries()) {
      const section = entry.part > 0 && !entry.file;
      const foreground =
        i === index
          ? theme.navigation.foreground
          : section
            ? theme.muted
            : theme.text;
      entry.row.fg = foreground;
      entry.row.bg = section
        ? i === index
          ? cursorBackground(theme.surface, theme.name)
          : theme.surface
        : i === index
          ? theme.navigation.background
          : theme.background;
      entry.row.content = entry.icon
        ? new StyledText([
            { __isChunk: true, text: entry.file ? "  " : "" },
            {
              __isChunk: true,
              text: entry.icon,
              fg: RGBA.fromHex(
                entry.status ? theme.fileStatus[entry.status] : foreground,
              ),
            },
            {
              __isChunk: true,
              text: ` ${entry.display}`,
              attributes: section ? TextAttributes.BOLD : undefined,
            },
          ])
        : entry.display;
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
    reactionPicker.resize();
    const modalWidth = Math.max(1, Math.min(88, renderer.width - 4));
    const modalHeight = Math.max(1, Math.min(42, renderer.height - 4));
    keybindingsModal.width = modalWidth;
    keybindingsModal.height = modalHeight;
    keybindingsModal.left = Math.max(
      0,
      Math.floor((renderer.width - modalWidth) / 2),
    );
    keybindingsModal.top = Math.max(
      0,
      Math.floor((renderer.height - modalHeight) / 2),
    );
    updateHelp();

    const release = anchorViewport();
    sidebar.visible = sidebarOverride ?? renderer.width >= 110;
    const width = Math.min(32, Math.max(1, Math.floor(renderer.width * 0.4)));
    sidebar.width = width;
    for (const entry of entries) {
      const prefix = entry.icon
        ? `${entry.file ? "  " : ""}${entry.icon} `
        : "";
      const max = Math.max(1, width - 2 - displayWidth(prefix));
      entry.display = truncate(entry.label, max, !!entry.file);
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
    reactionPicker.setTheme(theme);
    renderer.setBackgroundColor(theme.background);
    root.backgroundColor = theme.background;
    searchBar.backgroundColor = theme.surface;
    searchInput.backgroundColor = theme.surface;
    searchInput.focusedBackgroundColor = theme.surface;
    searchInput.textColor = theme.text;
    searchInput.focusedTextColor = theme.text;
    searchQuery.fg = theme.text;
    searchQuery.bg = theme.surface;
    searchPrompt.fg = theme.text;
    searchPrompt.bg = theme.surface;
    searchCount.fg = theme.muted;
    searchCount.bg = theme.surface;
    if (searchState !== "inactive") updateSearch();
    help.fg = theme.muted;
    help.bg = theme.background;
    keybindingsModal.backgroundColor = theme.surface;
    keybindingsModal.borderColor = theme.navigation.foreground;
    keybindingsModal.titleColor = theme.navigation.foreground;
    keybindingsPanel.backgroundColor = theme.surface;
    keybindingsText.bg = theme.surface;
    keybindingsHint.fg = theme.muted;
    keybindingsHint.bg = theme.surface;
    updateHelp();
    sidebar.borderColor = theme.border;
    for (const node of texts) {
      node.setCursorTheme(theme.name);
      node.fg = theme.markdown.text;
      node.bg = theme.background;
    }
    for (const node of markdowns) node.setTheme(theme);
    prHeader.setTheme(theme);
    for (const node of separators) {
      node.borderColor = theme.border;
      node.backgroundColor = theme.background;
    }
    for (const part of parts) {
      part.root.backgroundColor = theme.background;
      part.narrative.backgroundColor = theme.background;
      part.explanation?.setTheme(theme);
      part.changes.setTheme(theme);
    }
    for (const scroll of [body, sidebar, keybindingsPanel]) {
      scroll.backgroundColor =
        scroll === keybindingsPanel ? theme.surface : theme.background;
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

  function focusDocumentLine(y: number, x?: number, exact = false) {
    const candidates = parts.flatMap((part, index) =>
      part.cursor.targets().map((target) => ({ ...target, index })),
    );
    const distance = (target: (typeof candidates)[number]) =>
      y < target.top ? target.top - y : Math.max(0, y - target.bottom + 1);
    const target = candidates.reduce<(typeof candidates)[number] | undefined>(
      (nearest, candidate) =>
        !nearest || distance(candidate) < distance(nearest)
          ? candidate
          : nearest,
      undefined,
    );
    if (!target || (exact && distance(target) !== 0)) return;

    navigationEpoch++;
    if (active !== target.index) parts[active].cursor.deactivate();
    active = target.index;
    target.focus(x);
    paintSidebar();
  }

  function carryCursorAfterScroll() {
    const selected = parts[active].cursor
      .targets()
      .find((target) => target.selected);
    const y = Math.max(
      body.viewport.y,
      Math.min(
        body.viewport.y + body.viewport.height - 1,
        selected?.top ?? body.viewport.y,
      ),
    );
    const epoch = navigationEpoch;
    const scroll = ++scrollEpoch;
    body.afterLayout(() => {
      if (
        body.isDestroyed ||
        epoch !== navigationEpoch ||
        scroll !== scrollEpoch
      )
        return;

      focusDocumentLine(y);
    });
  }

  function scrollDocument(amount: number) {
    carryCursorAfterScroll();
    body.scrollBy(amount);
  }

  body.onMouseDown = (event) => {
    if (event.button !== 0 || parts.some((part) => part.changes.editing))
      return;
    if (
      event.x < body.viewport.x ||
      event.x >= body.viewport.x + body.viewport.width
    )
      return;

    focusDocumentLine(event.y, event.x, true);
  };
  body.onMouseScroll = () => {
    if (!parts.some((part) => part.changes.editing)) carryCursorAfterScroll();
  };

  function searchTargets(): SearchTarget[] {
    const targets: SearchTarget[] = [];
    parts.forEach((part, index) => {
      const activate = () => {
        navigationEpoch++;
        if (active !== index) parts[active].cursor.deactivate();
        active = index;
      };
      const walk = (node: Renderable, path: string) => {
        if (!node.visible || node.isDestroyed) return;
        if (node instanceof CursorText) {
          if (!node.cursorEnabled) return;

          targets.push(
            ...node.searchTargets(path, body, (line) => {
              activate();
              part.cursor.focusText(node, line);
              paintSidebar();
            }),
          );
          return;
        }
        node.getChildren().forEach((child, childIndex) => {
          walk(child, `${path}:${childIndex}`);
        });
      };
      walk(part.narrative, `${index}:narrative`);
      if (part.explanation) walk(part.explanation, `${index}:explanation`);
      for (const target of part.changes.searchTargets()) {
        targets.push({
          ...target,
          id: `${index}:diff:${target.id}`,
          focus: (offset) => {
            activate();
            part.cursor.focusDiff(() => target.focus(offset));
            paintSidebar();
          },
        });
      }
    });
    return targets;
  }

  function updateSearch() {
    const targets = searchTargets();
    search.update(targets, theme.search);
    searchRevision = SearchText.revision;
    const count = search.matches.length;
    const current = search.focused
      ? search.matches.indexOf(search.focused) + 1
      : 0;
    const label = search.query.replaceAll("\\c", "")
      ? count
        ? ` ${current}/${count} `
        : " No matches "
      : "";
    if (searchCount.plainText !== label) searchCount.content = label;
    return targets;
  }

  function clearSearch() {
    const release = anchorViewport();
    searchInput.blur();
    searchState = "inactive";
    search.query = "";
    search.focused = undefined;
    updateSearch();
    searchBar.visible = false;
    body.afterLayout(release);
  }

  function openSearch() {
    const release = anchorViewport();
    searchState = "editing";
    search.query = "";
    search.focused = undefined;
    searchInput.value = "";
    searchInput.visible = true;
    searchQuery.visible = false;
    searchBar.visible = true;
    searchInput.focus();
    updateSearch();
    body.afterLayout(release);
  }

  function navigateSearch(direction: 1 | -1, initial = false) {
    const targets = updateSearch();
    search.navigate(targets, direction, initial);
    updateSearch();
  }

  searchInput.on(InputRenderableEvents.INPUT, () => {
    if (searchState !== "editing") return;

    search.query = searchInput.value;
    search.focused = undefined;
    updateSearch();
  });

  function onKey(key: KeyEvent) {
    if (reactionPicker.handleKey(key)) return;
    const editor = parts.find((part) => part.changes.editing)?.changes;
    const action = keyAction(
      bindings,
      key,
      editor ? "editor" : searchState === "editing" ? "search" : "viewer",
    );
    if (action === "interrupt") {
      key.preventDefault();
      renderer.destroy();
      return;
    }
    if (editor?.handleCommentKey(key)) return;
    if (keybindingsOverlay.visible) {
      if (action === "toggle_help" || key.name === "escape") {
        keybindingsOverlay.visible = false;
      } else if (action === "quit") {
        renderer.destroy();
      } else if (action === "scroll_down" || action === "cursor_down") {
        keybindingsPanel.scrollBy(1);
      } else if (action === "scroll_up" || action === "cursor_up") {
        keybindingsPanel.scrollBy(-1);
      } else if (action === "page_down" || action === "page_up") {
        keybindingsPanel.scrollBy(
          (action === "page_down" ? 1 : -1) *
            Math.max(1, keybindingsPanel.viewport.height - 1),
        );
      }
      key.preventDefault();
      return;
    }
    if (searchState === "editing") {
      if (action === "clear_search") {
        clearSearch();
        key.preventDefault();
      } else if (action === "submit_search") {
        key.preventDefault();
        if (!search.query.replaceAll("\\c", "")) clearSearch();
        else {
          searchState = "committed";
          searchInput.blur();
          searchInput.visible = false;
          searchQuery.content = search.query;
          searchQuery.visible = true;
          navigateSearch(1, true);
        }
      }
      return;
    }
    if (!action) return;
    const part = parts[active];
    switch (action) {
      case "open_search":
        openSearch();
        break;
      case "clear_search":
        if (searchState !== "inactive") clearSearch();
        break;
      case "next_match":
      case "previous_match":
        if (searchState === "committed")
          navigateSearch(action === "next_match" ? 1 : -1);
        break;
      case "toggle_help":
        keybindingsOverlay.visible = true;
        break;
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
        scrollDocument(1);
        break;
      case "scroll_up":
        scrollDocument(-1);
        break;
      case "page_down":
        scrollDocument(Math.max(1, body.viewport.height - 1));
        break;
      case "page_up":
        scrollDocument(-Math.max(1, body.viewport.height - 1));
        break;
      case "half_page_down":
        scrollDocument(Math.max(1, Math.floor(body.viewport.height / 2)));
        break;
      case "half_page_up":
        scrollDocument(-Math.max(1, Math.floor(body.viewport.height / 2)));
        break;
      case "open_reactions":
        part.changes.openReactions();
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

  const onPaste = (event: PasteEvent) => {
    if (reactionPicker.overlay.visible) {
      event.preventDefault();
      return;
    }
    parts
      .find((part) => part.changes.editing)
      ?.changes.handleCommentPaste(event);
  };
  const onFrame = () => {
    for (const part of parts) part.explanation?.checkGeometry();
    parts[active].cursor.refresh();
    if (searchState !== "inactive" && searchRevision !== SearchText.revision)
      updateSearch();
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
