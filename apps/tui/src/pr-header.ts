import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  StyledText,
  TextAttributes,
  type TextChunk,
} from "@opentui/core";
import type { ReviewSnapshot } from "../../../packages/core/src";
import type { Theme } from "./theme";

import { CursorText } from "./cursor-text";

type PullRequest = ReviewSnapshot["pullRequest"];

// Nerd Fonts' Octicons: git-pull-request-draft, git-pull-request,
// git-merge, and git-pull-request-closed.
const badges = {
  draft: { label: "Draft", icon: "\uf4dd" },
  open: { label: "Open", icon: "\uf407" },
  merged: { label: "Merged", icon: "\uf419" },
  closed: { label: "Closed", icon: "\uf4dc" },
};

function prLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)
    )
      return url.href;
  } catch {
    // Legacy artifacts can contain arbitrary URL strings; keep them passive.
  }

  return undefined;
}

/** Captured PR metadata, styled without interpreting any field as Markdown. */
export class PullRequestHeader extends BoxRenderable {
  private readonly titleNode: CursorText;
  private readonly details: CursorText;

  constructor(
    renderer: CliRenderer,
    private readonly pr: PullRequest,
    theme: Theme,
  ) {
    super(renderer, {
      id: "pr-header",
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      marginBottom: 1,
    });

    this.titleNode = new CursorText(renderer, {
      id: "pr-title",
      width: "100%",
      wrapMode: "word",
      flexShrink: 0,
    });
    this.details = new CursorText(renderer, {
      id: "pr-details",
      width: "100%",
      wrapMode: "word",
      flexShrink: 0,
    });
    this.add(this.titleNode);
    this.add(this.details);
    this.setTheme(theme);
  }

  setTheme(theme: Theme) {
    const pr = this.pr;
    const colors = theme.pullRequest;
    const chunk = (
      text: string,
      fg = theme.text,
      bg = theme.background,
      attributes = 0,
    ): TextChunk => ({
      __isChunk: true,
      text,
      fg: RGBA.fromHex(fg),
      bg: RGBA.fromHex(bg),
      attributes,
    });
    const url = prLink(pr.url);

    this.backgroundColor = theme.background;
    this.titleNode.setCursorTheme(theme.name);
    this.details.setCursorTheme(theme.name);
    this.titleNode.bg = theme.background;
    this.details.bg = theme.background;
    this.titleNode.content = new StyledText([
      chunk(pr.title, theme.text, theme.background, TextAttributes.BOLD),
      chunk(" "),
      {
        ...chunk(`#${pr.number}`, colors.number),
        ...(url ? { link: { url } } : {}),
      },
    ]);

    const details: TextChunk[] = [];
    if (pr.status) {
      const badge = badges[pr.status];

      details.push(
        chunk(
          ` ${badge.icon} ${badge.label} `,
          colors.badgeForeground,
          colors[pr.status],
        ),
        chunk(" "),
      );
    }

    details.push(
      chunk(pr.author, theme.text, theme.background, TextAttributes.UNDERLINE),
    );

    if (
      pr.commitCount !== undefined &&
      pr.baseRefName !== undefined &&
      pr.headRefName !== undefined
    ) {
      const verb =
        pr.status === "merged"
          ? "merged"
          : pr.status === "closed"
            ? "proposed merging"
            : "wants to merge";
      const branch = (name: string) =>
        chunk(` ${name} `, colors.branch.foreground, colors.branch.background);

      details.push(
        chunk(
          ` ${verb} ${pr.commitCount} ${pr.commitCount === 1 ? "commit" : "commits"} into `,
          theme.muted,
        ),
        branch(pr.baseRefName),
        chunk(" from ", theme.muted),
        branch(pr.headRefName),
      );
    }

    this.details.content = new StyledText(details);
  }
}
