import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { LoadedReview } from "./load";
import { renderSectionDiff } from "./diff";

/** A summary followed by the artifact's sections, in their original order. */
export function mountReview(renderer: CliRenderer, review: LoadedReview): void {
  const { snapshot, analysis } = review;
  const pr = snapshot.pullRequest;
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
    fg: "#79c0ff",
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
  const narrative = new TextRenderable(renderer, {
    id: "narrative",
    content: "",
    wrapMode: "word",
    flexShrink: 0,
  });
  body.add(narrative);
  const changes = new TextRenderable(renderer, {
    id: "changes",
    content: "",
    wrapMode: "char",
    flexShrink: 0,
  });
  body.add(changes);
  const help = new TextRenderable(renderer, {
    id: "help",
    content:
      "n/p ←/→ Tab: sections | s/Home: summary | End: last\n↑/↓ j/k PgUp/PgDn: scroll | q/Ctrl+C: quit",
    wrapMode: "word",
    fg: "#8b949e",
    flexShrink: 0,
  });
  root.add(heading);
  root.add(body);
  root.add(help);
  renderer.root.add(root);

  function showPage() {
    const section = snapshot.sections[page - 1];
    heading.content = `${pr.owner}/${pr.repository} #${pr.number} · ${page === 0 ? "Summary" : `Section ${page}/${snapshot.sections.length}: ${section.title}`}\n`;
    if (page === 0) {
      changes.content = "";
      const limits = snapshot.files
        .filter((file) => file.diff.kind !== "text")
        .map(
          (file) =>
            `${file.newPath ?? file.oldPath}: ${file.diff.kind === "unavailable" ? `unavailable (${file.diff.reason})` : "binary"}`,
        );
      narrative.content = [
        pr.title,
        `${pr.url}\nAuthor: ${pr.author}\nBase: ${pr.baseCommit}\nHead: ${pr.headCommit}`,
        `${snapshot.files.length} files · ${snapshot.sections.length} sections`,
        ...(analysis.uncovered.length > 0
          ? [
              `Coverage: ${analysis.uncovered.length} file(s) have changes or markers outside the walkthrough.`,
            ]
          : []),
        ...(limits.length > 0 ? [`Diff limits:\n${limits.join("\n")}`] : []),
        `Summary\n${snapshot.summary || "(No summary)"}`,
        `PR description\n${pr.description || "(No description)"}`,
        `Sections\n${snapshot.sections.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n") || "(No sections)"}`,
      ].join("\n\n");
    } else {
      narrative.content = [
        section.title,
        section.explanation || "(No explanation)",
        ...(section.diagram ? [`Diagram\n${section.diagram}`] : []),
      ].join("\n\n");
      changes.content = `\n\n${renderSectionDiff(analysis.sections[page - 1])}`;
    }
    body.scrollTo(0);
  }

  function onKey(key: KeyEvent) {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      return;
    }
    if (key.ctrl || key.meta || key.option) return;
    let nextPage = page;
    switch (key.name) {
      case "n":
      case "right":
        nextPage++;
        break;
      case "p":
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
      case "down":
        body.scrollBy(1);
        break;
      case "k":
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
  renderer.once("destroy", () => renderer.keyInput.off("keypress", onKey));
  showPage();
}
