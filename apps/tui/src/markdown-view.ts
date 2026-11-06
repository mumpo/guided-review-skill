import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  StyledText,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";
import { Lexer, type Links, type Token, type Tokens } from "marked";
import {
  languageForFence,
  readableTokenColor,
  type SyntaxSpan,
} from "./highlight";
import { sessionHighlights, type SyntaxService } from "./highlight-service";
import type { Theme, ThemeName } from "./theme";

type Run = {
  text: string;
  role?: "heading" | "link" | "code";
  attributes?: number;
};

/** Collect once per field, including definitions on the other side of a diagram. */
export function markdownLinks(source: string): Links {
  try {
    return Lexer.lex(source).links;
  } catch {
    return {};
  }
}

function inline(tokens: Token[], inherited: Run = { text: "" }): Run[] {
  return tokens.flatMap((token): Run[] => {
    switch (token.type) {
      case "strong":
      case "em":
        return inline(token.tokens ?? [], {
          ...inherited,
          attributes:
            (inherited.attributes ?? 0) |
            (token.type === "strong"
              ? TextAttributes.BOLD
              : TextAttributes.ITALIC),
        });
      case "codespan":
        return [{ ...inherited, text: token.text, role: "code" }];
      case "link": {
        const label = inline(token.tokens ?? [], {
          ...inherited,
          role: "link",
        });
        if (label.map((run) => run.text).join("") !== token.href)
          label.push({ ...inherited, role: "link", text: ` (${token.href})` });
        if (token.title)
          label.push({ ...inherited, role: "link", text: ` "${token.title}"` });

        return label;
      }
      case "br":
        return [{ ...inherited, text: "\n" }];
      case "text":
        return token.tokens
          ? inline(token.tokens, inherited)
          : [{ ...inherited, text: token.text }];
      case "escape":
        return [{ ...inherited, text: token.text }];
      default:
        // HTML, images and unsupported inline syntax remain visible source.
        return [{ ...inherited, text: token.raw }];
    }
  });
}

export function closedFence(token: Tokens.Code): boolean {
  if (token.codeBlockStyle === "indented") return true;

  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(token.raw);
  if (!opening) return false;

  const closing = new RegExp(
    `\\n {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*(?:\\n)?$`,
  );

  return closing.test(token.raw);
}

/** Offline presentation only: plain styled chunks never carry active hyperlinks. */
export class MarkdownView extends BoxRenderable {
  private controller = new AbortController();
  private painted: {
    node: TextRenderable;
    runs: Run[];
    code: boolean;
    syntax?: Record<ThemeName, SyntaxSpan[][]>;
  }[] = [];

  constructor(
    private renderer: CliRenderer,
    private palette: Theme,
    private highlights: SyntaxService = sessionHighlights(renderer),
  ) {
    super(renderer, {
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      minWidth: 0,
    });
  }

  setContent(content: string, links: Links = {}) {
    this.controller.abort();
    this.controller = new AbortController();
    for (const child of this.getChildren()) child.destroyRecursively();

    this.painted = [];
    if (!content) return;

    try {
      const lexer = new Lexer({ gfm: true });

      Object.assign(lexer.tokens.links, links);
      this.blocks(this, lexer.lex(content));
    } catch {
      for (const child of this.getChildren()) child.destroyRecursively();

      this.painted = [];
      this.text(this, [{ text: content }]);
    }

    this.setTheme(this.palette);
  }

  private text(parent: BoxRenderable, runs: Run[], code = false) {
    const node = new TextRenderable(this.renderer, {
      width: "100%",
      minWidth: 0,
      flexShrink: 0,
      wrapMode: code ? "char" : "word",
      content: "",
    });

    parent.add(node);
    this.painted.push({ node, runs, code });

    return node;
  }

  protected destroySelf() {
    this.controller.abort();
    super.destroySelf();
  }

  private blocks(parent: BoxRenderable, tokens: Token[]) {
    for (const token of tokens) {
      switch (token.type) {
        case "def":
          // Definitions have already resolved inline references for the field.
          break;
        case "space":
          // Tokens include blank lines after paragraphs; maintain one empty row.
          this.text(parent, [{ text: " " }]);
          break;
        case "heading":
          this.text(
            parent,
            inline(token.tokens ?? [], {
              text: "",
              role: "heading",
              attributes: TextAttributes.BOLD,
            }),
          ).marginBottom = 1;
          break;
        case "paragraph":
        case "text":
          this.text(
            parent,
            token.tokens ? inline(token.tokens) : [{ text: token.text }],
          );
          break;
        case "list": {
          const list = token as Tokens.List;
          if (list.items.some((item) => item.task)) {
            this.text(parent, [{ text: list.raw }]);
            break;
          }

          list.items.forEach((item, index) => {
            const marker = list.ordered
              ? `${Number(list.start) + index}. `
              : "• ";
            const row = new BoxRenderable(this.renderer, {
              width: "100%",
              flexDirection: "row",
              flexShrink: 0,
              minWidth: 0,
            });

            parent.add(row);

            const prefix = new BoxRenderable(this.renderer, {
              width: marker.length,
              flexShrink: 0,
            });

            row.add(prefix);
            this.text(prefix, [{ text: marker }]);

            const body = new BoxRenderable(this.renderer, {
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 1,
              flexDirection: "column",
            });

            row.add(body);
            this.blocks(body, item.tokens);
            if (list.loose) row.marginBottom = 1;
          });
          break;
        }
        case "code": {
          const code = token as Tokens.Code;
          if (!closedFence(code) || code.lang?.trim() === "mermaid") {
            this.text(parent, [{ text: code.raw }]);
          } else {
            this.text(parent, [{ text: code.text }], true);
            const entry = this.painted[this.painted.length - 1];
            const signal = this.controller.signal;

            void this.highlights
              .highlight(code.text, languageForFence(code.lang), signal)
              .then((colors) => {
                if (!colors || signal.aborted || this.isDestroyed) return;

                entry.syntax = colors;
                this.setTheme(this.palette);
              });
          }

          break;
        }
        default:
          this.text(parent, [{ text: token.raw }]);
      }
    }
  }

  setTheme(theme: Theme) {
    this.palette = theme;
    this.backgroundColor = theme.background;

    for (const { node, runs, code, syntax } of this.painted) {
      const background = code
        ? theme.markdown.codeBackground
        : theme.background;
      node.fg = code ? theme.markdown.code : theme.markdown.text;
      node.bg = background;

      const colored = syntax?.[theme.name].flatMap((line, index) => [
        ...(index ? [{ text: "\n" }] : []),
        ...line,
      ]);
      node.content = new StyledText(
        colored
          ? colored.map((span) => ({
              __isChunk: true,
              text: span.text,
              fg: RGBA.fromHex(
                readableTokenColor(span.color, theme.markdown.code, background),
              ),
              bg: RGBA.fromHex(background),
            }))
          : runs.map((run) => ({
              __isChunk: true,
              text: run.text,
              attributes: run.attributes,
              fg: RGBA.fromHex(
                run.role
                  ? theme.markdown[run.role]
                  : code
                    ? theme.markdown.code
                    : theme.markdown.text,
              ),
              bg: RGBA.fromHex(
                run.role === "code"
                  ? theme.markdown.codeBackground
                  : background,
              ),
            })),
      );
    }
  }
}
