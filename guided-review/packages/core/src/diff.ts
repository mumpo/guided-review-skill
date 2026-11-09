import type { DiffFile, ReviewSnapshot } from "./index";

/** A physical line exactly as it appeared in the diff, including its line ending. */
export interface DiffLine {
  kind: "context" | "addition" | "deletion" | "no-newline";
  raw: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type ParsedDiff =
  | { kind: "text"; header: string[]; hunks: DiffHunk[] }
  | { kind: "binary" }
  | { kind: "unavailable"; reason: string };

export interface ParsedFile {
  file: DiffFile;
  diff: ParsedDiff;
}

export class DiffParseError extends Error {
  constructor(fileId: string, message: string) {
    super(`File ${JSON.stringify(fileId)}: ${message}`);
    this.name = "DiffParseError";
  }
}

/** Parse a single file's unified diff without losing any supplied text. */
export function parseDiff(file: DiffFile): ParsedDiff {
  if (file.diff.kind !== "text") return file.diff;

  const rawLines = file.diff.unified.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const content = (line: string) => line.replace(/\r?\n$/, "");

  const error = (message: string): never => {
    throw new DiffParseError(file.id, message);
  };

  const header: string[] = [];
  const hunks: DiffHunk[] = [];
  let index = 0;
  let hasGitHeader = false;
  let hasOldHeader = false;
  let hasNewHeader = false;

  while (
    index < rawLines.length &&
    !content(rawLines[index]).startsWith("@@")
  ) {
    const line = content(rawLines[index]);
    if (line.startsWith("diff --git ")) {
      if (hasGitHeader || header.length > 0)
        error("multiple or misplaced file headers");

      hasGitHeader = true;
    } else if (line.startsWith("--- ")) {
      if (hasOldHeader || hasNewHeader)
        error("multiple or misplaced old file headers");

      hasOldHeader = true;
    } else if (line.startsWith("+++ ")) {
      if (!hasOldHeader || hasNewHeader)
        error("multiple or misplaced new file headers");

      hasNewHeader = true;
    } else if (
      !/^(index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/.test(
        line,
      ) ||
      hasOldHeader
    ) {
      error(`unsupported diff content at line ${index + 1}: ${line}`);
    }

    header.push(rawLines[index++]);
  }

  if (hasOldHeader !== hasNewHeader) error("incomplete file headers");
  if (header.length === 0 && rawLines.length === 0) error("empty diff");

  let previousOldEnd = 0;
  let previousNewEnd = 0;

  while (index < rawLines.length) {
    const rawHeader = rawLines[index++];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(
      content(rawHeader),
    );
    if (!match) error(`expected hunk header at line ${index}`);

    const [, oldStartText, oldCountText, newStartText, newCountText] =
      match as RegExpExecArray;
    const oldStart = Number(oldStartText);
    const oldCount = oldCountText === undefined ? 1 : Number(oldCountText);
    const newStart = Number(newStartText);
    const newCount = newCountText === undefined ? 1 : Number(newCountText);
    if (
      ![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) ||
      (oldCount > 0 && oldStart === 0) ||
      (newCount > 0 && newStart === 0) ||
      oldStart + (oldCount === 0 ? 1 : 0) < previousOldEnd ||
      newStart + (newCount === 0 ? 1 : 0) < previousNewEnd
    )
      error(`invalid or overlapping hunk at line ${index}`);

    const hunk: DiffHunk = {
      header: rawHeader,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: [],
    };
    let oldUsed = 0;
    let newUsed = 0;

    while (index < rawLines.length) {
      const raw = rawLines[index];
      const line = content(raw);
      if (line.startsWith("@@")) break;
      if (line === "\\ No newline at end of file") {
        const previous = hunk.lines.at(-1);
        if (!previous || previous.kind === "no-newline")
          error(`misplaced no-newline marker at line ${index + 1}`);

        hunk.lines.push({
          kind: "no-newline",
          raw,
          oldLine: null,
          newLine: null,
        });
        index++;
        continue;
      }

      const prefix = line[0];
      if (prefix !== " " && prefix !== "+" && prefix !== "-")
        error(`unsupported hunk content at line ${index + 1}: ${line}`);
      if (oldUsed === oldCount && newUsed === newCount)
        error(`extra hunk content at line ${index + 1}`);

      const oldLine = prefix === "+" ? null : oldStart + oldUsed++;
      const newLine = prefix === "-" ? null : newStart + newUsed++;
      if (oldUsed > oldCount || newUsed > newCount)
        error(`hunk line counts exceeded at line ${index + 1}`);

      hunk.lines.push({
        kind:
          prefix === " " ? "context" : prefix === "+" ? "addition" : "deletion",
        raw,
        oldLine,
        newLine,
      });
      index++;
    }

    if (oldUsed !== oldCount || newUsed !== newCount)
      error(
        `truncated hunk: expected ${oldCount} old and ${newCount} new lines, got ${oldUsed} and ${newUsed}`,
      );

    previousOldEnd = oldStart + (oldCount === 0 ? 1 : oldCount);
    previousNewEnd = newStart + (newCount === 0 ? 1 : newCount);
    hunks.push(hunk);
  }

  return { kind: "text", header, hunks };
}

export interface ResolvedReference {
  referenceIndex: number;
  file: ParsedFile;
  /** Selected changed lines; whole-file references also include context and markers. */
  hunks: DiffHunk[];
}

export interface ReferenceDiagnostic {
  sectionIndex: number;
  referenceIndex: number;
  message: string;
}

export interface UncoveredFile {
  fileId: string;
  kind: "text" | "binary" | "unavailable";
  lines: DiffLine[];
}

export interface DiffAnalysis {
  files: ParsedFile[];
  sections: ResolvedReference[][];
  invalidReferences: ReferenceDiagnostic[];
  uncovered: UncoveredFile[];
}

/** Resolve references and assess coverage of every captured changed line. */
export function analyzeDiffs(snapshot: ReviewSnapshot): DiffAnalysis {
  const files = snapshot.files.map((file) => ({ file, diff: parseDiff(file) }));
  const byId = new Map(files.map((file) => [file.file.id, file]));
  const covered = new Set<DiffLine>();
  const coveredFiles = new Set<string>();
  const invalidReferences: ReferenceDiagnostic[] = [];

  const sections = snapshot.sections.map((section, sectionIndex) => {
    const resolved: ResolvedReference[] = [];

    section.references.forEach((reference, referenceIndex) => {
      const file = byId.get(reference.fileId);
      const invalid = (message: string) =>
        invalidReferences.push({ sectionIndex, referenceIndex, message });
      if (!file) {
        invalid(`Unknown file ID ${JSON.stringify(reference.fileId)}`);
        return;
      }
      if (reference.kind === "file") {
        coveredFiles.add(reference.fileId);

        const hunks = file.diff.kind === "text" ? file.diff.hunks : [];

        for (const hunk of hunks)
          for (const line of hunk.lines) covered.add(line);

        resolved.push({ referenceIndex, file, hunks });
        return;
      }
      if (file.diff.kind !== "text") {
        invalid(
          `Line reference requires a text diff for ${JSON.stringify(reference.fileId)}`,
        );
        return;
      }

      const hunks = file.diff.hunks.flatMap((hunk) => {
        const selected = (line: DiffLine) => {
          const number = reference.side === "old" ? line.oldLine : line.newLine;

          return (
            line.kind ===
              (reference.side === "old" ? "deletion" : "addition") &&
            number !== null &&
            number >= reference.startLine &&
            number <= reference.endLine
          );
        };

        const lines = hunk.lines.filter(
          (line, index) =>
            selected(line) ||
            (line.kind === "no-newline" &&
              index > 0 &&
              selected(hunk.lines[index - 1])),
        );

        return lines.length ? [{ ...hunk, lines }] : [];
      });
      if (!hunks.length) {
        invalid(
          `Range selects no changed ${reference.side} lines in ${JSON.stringify(reference.fileId)}`,
        );
        return;
      }

      for (const hunk of hunks)
        for (const line of hunk.lines) covered.add(line);

      resolved.push({ referenceIndex, file, hunks });
    });

    return resolved;
  });

  const uncovered: UncoveredFile[] = [];

  for (const { file, diff } of files) {
    if (diff.kind !== "text") {
      if (!coveredFiles.has(file.id))
        uncovered.push({ fileId: file.id, kind: diff.kind, lines: [] });

      continue;
    }

    const lines = diff.hunks.flatMap((hunk) =>
      hunk.lines.filter(
        (line) =>
          (line.kind === "addition" || line.kind === "deletion") &&
          !covered.has(line),
      ),
    );
    if (lines.length || (diff.hunks.length === 0 && !coveredFiles.has(file.id)))
      uncovered.push({ fileId: file.id, kind: "text", lines });
  }

  return { files, sections, invalidReferences, uncovered };
}
