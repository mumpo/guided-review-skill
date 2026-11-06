import { Lexer, type Token, type Tokens } from "marked";
import type { LoadedReview } from "./load";
import { sectionDiffRows } from "./diff";
import {
  languageForFence,
  languageForPath,
  sourceFragments,
} from "./highlight";
import { closedFence } from "./markdown-view";
import { explanationBlocks } from "./mermaid";

function* codeSamples(
  tokens: Token[],
): Generator<{ source: string; language: string }> {
  for (const token of tokens) {
    if (token.type === "list") {
      const list = token as Tokens.List;
      if (!list.items.some((item) => item.task)) {
        for (const item of list.items) yield* codeSamples(item.tokens);
      }
    } else if (token.type === "code") {
      const code = token as Tokens.Code;
      const language = languageForFence(code.lang);
      if (language && closedFence(code)) yield { source: code.text, language };
    }
  }
}

/** Match displayed Markdown eligibility; Mermaid source and unsupported blocks stay opaque. */
function markdownSamples(source: string) {
  try {
    return [...codeSamples(Lexer.lex(source))];
  } catch {
    return [];
  }
}

/** First selected sample per language warms regexes as well as loading the grammar. */
export function reviewSyntaxSamples({ snapshot, analysis }: LoadedReview) {
  const samples = new Map<string, { source: string; language: string }>();
  const add = (sample: { source: string; language: string }) => {
    if (!samples.has(sample.language)) samples.set(sample.language, sample);
  };

  for (const sample of markdownSamples(snapshot.pullRequest.description))
    add(sample);

  for (const [index, section] of snapshot.sections.entries()) {
    for (const block of explanationBlocks(section.explanation)) {
      if (block.kind === "text") {
        for (const sample of markdownSamples(block.raw)) add(sample);
      }
    }
    for (const file of sectionDiffRows(analysis.sections[index])) {
      for (const fragment of sourceFragments(file)) add(fragment);
    }
  }
  // Paths can identify supported languages even for binary or unselected files.
  for (const file of snapshot.files) {
    for (const path of [file.oldPath, file.newPath]) {
      const language = languageForPath(path);
      if (language) add({ language, source: "" });
    }
  }

  return [...samples.values()];
}
