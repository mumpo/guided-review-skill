import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { LoadedReview } from "./load";
import { type DiffMode, sectionDiffRows } from "./diff";
import { DiffView } from "./diff-view";
import { ExplanationView } from "./explanation-view";
import { MarkdownView } from "./markdown-view";
import { sessionHighlights } from "./highlight-service";
import { reviewSyntaxSamples } from "./highlight-preload";
import { type Theme, themes } from "./theme";
import { PullRequestHeader } from "./pr-header";
import { githubCommentPublisher, type PublishComment } from "./comments";

/** A summary followed by the artifact's sections, in their original order. */
export function mountReview(
  renderer: CliRenderer,
  review: LoadedReview,
  theme: Theme = themes["github-dark"],
  diffMode: DiffMode = "auto",
  publish?: PublishComment,
): (theme: Theme) => void {
  const { snapshot, analysis } = review;
  const pr = snapshot.pullRequest;
  const commentController = new AbortController();
  let page = 0;

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

  const body = new ScrollBoxRenderable(renderer, {
    id: "body",
    flexGrow: 1,
    minHeight: 0,
    scrollX: false,
    scrollY: true,
    contentOptions: { flexDirection: "column" },
  });

  const narrative = new BoxRenderable(renderer, {
    id: "narrative",
    width: "100%",
    flexDirection: "column",
    flexShrink: 0,
  });
  let narrativeText: TextRenderable[] = [];
  let narrativeMarkdown: MarkdownView[] = [];
  let prHeader: PullRequestHeader | undefined;
  let descriptionSeparator: BoxRenderable | undefined;

  function plain(content: string) {
    const node = new TextRenderable(renderer, {
      content,
      width: "100%",
      wrapMode: "word",
      flexShrink: 0,
      fg: theme.markdown.text,
      bg: theme.background,
      marginBottom: 1,
    });

    narrative.add(node);
    narrativeText.push(node);
  }

  function markdown(content: string) {
    const node = new MarkdownView(renderer, theme);
    node.marginBottom = 1;
    node.setContent(content);
    narrative.add(node);
    narrativeMarkdown.push(node);
  }

  body.add(narrative);

  const explanation = new ExplanationView(renderer, body, theme);
  body.add(explanation);

  const changes = new DiffView(
    renderer,
    body,
    theme,
    sessionHighlights(renderer),
    publish ?? githubCommentPublisher(pr, undefined, commentController.signal),
  );
  body.add(changes);

  const help = new TextRenderable(renderer, {
    id: "help",
    content: "",
    wrapMode: "word",
    flexShrink: 0,
  });

  root.add(heading);
  root.add(body);
  root.add(help);
  renderer.root.add(root);

  function applyTheme(nextTheme: Theme) {
    theme = nextTheme;
    renderer.setBackgroundColor(theme.background);
    root.backgroundColor = theme.background;
    heading.fg = theme.navigation.foreground;
    heading.bg = theme.navigation.background;
    narrative.backgroundColor = theme.background;

    for (const node of narrativeText) {
      node.fg = theme.markdown.text;
      node.bg = theme.background;
    }

    for (const node of narrativeMarkdown) node.setTheme(theme);

    prHeader?.setTheme(theme);

    if (descriptionSeparator) {
      descriptionSeparator.borderColor = theme.muted;
      descriptionSeparator.backgroundColor = theme.background;
    }

    explanation.setTheme(theme);
    changes.setTheme(theme);
    help.fg = theme.muted;
    help.bg = theme.surface;
    body.scrollbarOptions = {
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

  applyTheme(theme);

  function updateHelp() {
    help.content = `n/p h/l ←/→ Tab: sections | s/Home: summary | End: last | d: diff ${diffMode}\nj/k: cursor | Space: side | c: comment | z: collapse | q/Ctrl+C: quit\n↑/↓ PgUp/PgDn: scroll | Ctrl+u/d: half page`;
  }

  updateHelp();

  function showPage() {
    const section = snapshot.sections[page - 1];
    heading.content = `${pr.owner}/${pr.repository} #${pr.number} · ${page === 0 ? "Summary" : `Section ${page}/${snapshot.sections.length}: ${section.title}`}\n`;

    for (const child of narrative.getChildren()) child.destroyRecursively();

    narrativeText = [];
    narrativeMarkdown = [];
    prHeader = undefined;
    descriptionSeparator = undefined;

    if (page === 0) {
      changes.setFiles([], diffMode);
      explanation.setContent("");

      const limits = snapshot.files
        .filter((file) => file.diff.kind !== "text")
        .map(
          (file) =>
            `${file.newPath ?? file.oldPath}: ${file.diff.kind === "unavailable" ? `unavailable (${file.diff.reason})` : "binary"}`,
        );

      prHeader = new PullRequestHeader(renderer, pr, theme);
      narrative.add(prHeader);

      plain(
        [
          `${pr.url}\nBase: ${pr.baseCommit}\nHead: ${pr.headCommit}`,
          `${snapshot.files.length} files · ${snapshot.sections.length} sections`,
          ...(analysis.uncovered.length > 0
            ? [
                `Coverage: ${analysis.uncovered.length} file(s) have changes or markers outside the walkthrough.`,
              ]
            : []),
          ...(limits.length > 0 ? [`Diff limits:\n${limits.join("\n")}`] : []),
        ].join("\n\n"),
      );
      descriptionSeparator = new BoxRenderable(renderer, {
        id: "description-separator",
        width: "100%",
        height: 1,
        flexShrink: 0,
        border: ["top"],
        borderColor: theme.muted,
        backgroundColor: theme.background,
        marginBottom: 1,
      });
      narrative.add(descriptionSeparator);
      markdown(pr.description || "(No description)");
      plain(
        `Sections\n${snapshot.sections.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n") || "(No sections)"}`,
      );
    } else {
      plain(section.title);
      explanation.setContent(section.explanation || "(No explanation)");

      const files = sectionDiffRows(analysis.sections[page - 1]);

      changes.setFiles(
        files.length
          ? files
          : [
              {
                id: "empty",
                width: 3,
                rows: [{ text: "(No referenced changes)", role: "marker" }],
              },
            ],
        diffMode,
      );
    }

    body.scrollTo(0);
  }

  function onKey(key: KeyEvent) {
    if (changes.handleCommentKey(key)) return;

    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      return;
    }
    if (key.meta || key.option) return;

    if (key.ctrl) {
      if (key.name === "u" || key.name === "d") {
        const distance = Math.max(1, Math.floor(body.viewport.height / 2));

        body.scrollBy(key.name === "u" ? -distance : distance);
        key.preventDefault();
      }

      return;
    }

    let nextPage = page;

    switch (key.name) {
      case "c":
        changes.openComment();
        break;
      case "z":
        changes.toggleVisibleFile();
        break;
      case "space":
        changes.switchSide();
        break;
      case "d": {
        const modes: DiffMode[] = ["auto", "inline", "side-by-side"];
        diffMode = modes[(modes.indexOf(diffMode) + 1) % modes.length];
        updateHelp();
        changes.setMode(diffMode);
        break;
      }
      case "n":
      case "l":
      case "right":
        nextPage++;
        break;
      case "p":
      case "h":
      case "left":
        nextPage--;
        break;
      case "tab":
        nextPage += key.shift ? -1 : 1;
        break;
      case "s":
      case "home":
        nextPage = 0;
        break;
      case "end":
        nextPage = snapshot.sections.length;
        break;
      case "j":
        if (page === 0) body.scrollBy(1);
        else changes.moveCursor(1);
        break;
      case "down":
        body.scrollBy(1);
        break;
      case "k":
        if (page === 0) body.scrollBy(-1);
        else changes.moveCursor(-1);
        break;
      case "up":
        body.scrollBy(-1);
        break;
      case "pagedown":
        body.scrollBy(Math.max(1, body.viewport.height - 1));
        break;
      case "pageup":
        body.scrollBy(-Math.max(1, body.viewport.height - 1));
        break;
      default:
        return;
    }

    key.preventDefault();
    nextPage = Math.max(0, Math.min(snapshot.sections.length, nextPage));
    if (page !== nextPage) {
      page = nextPage;
      showPage();
    }
  }

  renderer.keyInput.on("keypress", onKey);
  const onPaste = (event: PasteEvent) => changes.handleCommentPaste(event);
  renderer.keyInput.on("paste", onPaste);

  const onResize = () => {
    changes.resizeLayout();
    explanation.resizeLayout();
  };

  const onCapabilities = () => explanation.resizeLayout();

  renderer.on("capabilities", onCapabilities);
  renderer.on("resize", onResize);
  renderer.once("destroy", () => {
    commentController.abort();
    renderer.keyInput.off("keypress", onKey);
    renderer.keyInput.off("paste", onPaste);
    renderer.off("resize", onResize);
    renderer.off("capabilities", onCapabilities);
  });
  showPage();
  sessionHighlights(renderer).preload(reviewSyntaxSamples(review));

  return applyTheme;
}
