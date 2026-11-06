import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import light from "shiki/themes/github-light-default.mjs";
import dark from "shiki/themes/github-dark-default.mjs";
import { highlightSource } from "./highlight";

/** Explicit local imports: artifact text can never select an arbitrary module. */
export const grammarLoaders = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
};

export function createSyntaxEngine() {
  const failed = new Set<string>();
  let core: ReturnType<typeof createHighlighterCore> | undefined;

  return async (source: string, language: string) => {
    if (!Object.hasOwn(grammarLoaders, language) || failed.has(language))
      return;

    try {
      core ??= createHighlighterCore({
        themes: [
          { ...light, name: "github-light" },
          { ...dark, name: "github-dark" },
        ],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
      const highlighter = await core;
      if (!highlighter.getLoadedLanguages().includes(language)) {
        const grammar =
          await grammarLoaders[language as keyof typeof grammarLoaders]();
        await highlighter.loadLanguage(grammar.default);
      }

      // Cold regex compilation can exceed Shiki's 500 ms per-line default.
      // It runs in the worker, so allow compilation without truncating colors.
      return highlightSource(source, language, (text, lang, theme) =>
        highlighter
          .codeToTokens(text, { lang, theme, tokenizeTimeLimit: 3000 })
          .tokens.map((line) =>
            line.map((token) => ({ text: token.content, color: token.color })),
          ),
      );
    } catch {
      failed.add(language);
      return;
    }
  };
}
