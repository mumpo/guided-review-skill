import type { DiffLine, ResolvedReference } from "../../../packages/core/src";

export type DiffMode = "auto" | "inline" | "side-by-side";

export type RowRole =
  | "file"
  | "hunk"
  | "marker"
  | "context"
  | "addition"
  | "deletion";

export interface DiffRow {
  text: string;
  role: RowRole;
  line?: DiffLine;
  prefix?: string;
}

export interface FileRows {
  id: string;
  oldPath?: string | null;
  newPath?: string | null;
  rows: DiffRow[];
  width: number;
}

/** Merge overlapping references, retaining the captured file, hunk, and line order. */
export function sectionDiffRows(references: ResolvedReference[]): FileRows[] {
  const files = new Map<ResolvedReference["file"], Set<DiffLine>>();

  for (const reference of references) {
    let selected = files.get(reference.file);
    if (!selected) {
      selected = new Set();
      files.set(reference.file, selected);
    }

    for (const hunk of reference.hunks)
      for (const line of hunk.lines) selected.add(line);
  }

  const blocks: FileRows[] = [];

  for (const [{ file, diff }, selected] of files) {
    const path =
      file.oldPath && file.newPath && file.oldPath !== file.newPath
        ? `${file.oldPath} -> ${file.newPath}`
        : (file.newPath ?? file.oldPath);
    const rows: DiffRow[] = [];
    const push = (text: string, role: RowRole) => rows.push({ text, role });

    let width = 3;

    push(`File: ${path} (${file.status})`, "file");
    if (diff.kind === "binary") {
      push("Binary file: textual diff is not available.", "marker");
    } else if (diff.kind === "unavailable") {
      push(`Diff unavailable: ${diff.reason}`, "marker");
    } else {
      for (const header of diff.header) push(stripEnding(header), "file");

      if (diff.hunks.length === 0) {
        push("Metadata-only change: no textual hunks.", "marker");
      } else {
        push(
          "Old | New | Diff (selected lines; original hunk headers)",
          "marker",
        );

        for (const line of selected)
          width = Math.max(
            width,
            String(Math.max(line.oldLine ?? 0, line.newLine ?? 0)).length,
          );

        let omittedHunks = false;

        for (const hunk of diff.hunks) {
          if (!hunk.lines.some((line) => selected.has(line))) {
            omittedHunks = true;
            continue;
          }
          if (omittedHunks)
            push("... unreferenced hunks omitted ...", "marker");

          omittedHunks = false;
          push(stripEnding(hunk.header), "hunk");

          let omittedLines = false;

          for (const line of hunk.lines) {
            if (!selected.has(line)) {
              omittedLines = true;
              continue;
            }
            if (omittedLines)
              push("... unreferenced lines omitted ...", "marker");

            omittedLines = false;

            const old = String(line.oldLine ?? "").padStart(width);
            const next = String(line.newLine ?? "").padStart(width);
            const prefix = `${old} | ${next} | `;

            rows.push({
              text: `${prefix}${stripEnding(line.raw)}`,
              prefix,
              role: line.kind === "no-newline" ? "marker" : line.kind,
              line,
            });
          }

          if (omittedLines)
            push("... unreferenced lines omitted ...", "marker");
        }

        if (omittedHunks) push("... unreferenced hunks omitted ...", "marker");
      }
    }

    blocks.push({
      id: file.id,
      oldPath: file.oldPath,
      newPath: file.newPath,
      rows,
      width,
    });
  }

  return blocks;
}

function stripEnding(raw: string): string {
  return raw.replace(/\r?\n$/, "");
}

/** Plain-text compatibility adapter; selection and coverage stay independent of layout. */
export function renderSectionDiff(references: ResolvedReference[]): string {
  return (
    sectionDiffRows(references)
      .map((file) => file.rows.map((row) => row.text).join("\n"))
      .join("\n\n") || "(No referenced changes)"
  );
}

export interface DiffCell {
  line?: DiffLine;
  side?: "old" | "new";
  marker?: string;
  text: string;
  prefix: string;
  role: RowRole;
}

export interface PresentationRow {
  /** Source row indices allow viewport anchoring across layout changes. */
  sources: number[];
  full?: DiffRow;
  left?: DiffCell;
  right?: DiffCell;
}

export function effectiveDiffMode(
  file: FileRows,
  preference: DiffMode,
  width: number,
): Exclude<DiffMode, "auto"> {
  if (preference !== "auto") return preference;

  return width >= 100 &&
    file.rows.some((r) => r.role === "addition") &&
    file.rows.some((r) => r.role === "deletion")
    ? "side-by-side"
    : "inline";
}

/** Positional pairing never crosses a context, omission, or hunk boundary. */
export function layoutFileRows(
  file: FileRows,
  mode: Exclude<DiffMode, "auto">,
): PresentationRow[] {
  if (mode === "inline")
    return file.rows.map((full, index) => ({ full, sources: [index] }));

  return pairedFileRows(file);
}

/** Shared positional pairing for layout and within-line comparisons. */
export function pairedFileRows(file: FileRows): PresentationRow[] {
  const result: PresentationRow[] = [];
  const cell = (row: DiffRow, side: "old" | "new"): DiffCell => ({
    line: row.line,
    side,
    prefix: `${String((side === "old" ? row.line?.oldLine : row.line?.newLine) ?? "").padStart(file.width)} | `,
    text: stripEnding(row.line?.raw ?? ""),
    role: row.role,
  });

  for (let i = 0; i < file.rows.length; ) {
    const row = file.rows[i];
    if (row.role === "addition" || row.role === "deletion") {
      const left: { cell: DiffCell; sources: number[] }[] = [];
      const right: typeof left = [];

      while (i < file.rows.length) {
        const current = file.rows[i];
        if (current.role !== "addition" && current.role !== "deletion") break;

        const side = current.role === "deletion" ? left : right;
        const entry = {
          cell: cell(current, current.role === "deletion" ? "old" : "new"),
          sources: [i++],
        };
        const marker = file.rows[i]?.line;
        if (marker?.kind === "no-newline") {
          entry.cell.marker = stripEnding(marker.raw);
          entry.sources.push(i++);
        }

        side.push(entry);
      }

      for (let j = 0; j < Math.max(left.length, right.length); j++)
        result.push({
          left: left[j]?.cell,
          right: right[j]?.cell,
          sources: [...(left[j]?.sources ?? []), ...(right[j]?.sources ?? [])],
        });
    } else if (row.line?.kind === "context") {
      const entry = {
        left: cell(row, "old"),
        right: cell(row, "new"),
        sources: [i++],
      };
      const marker = file.rows[i]?.line;
      if (marker?.kind === "no-newline") {
        entry.left.marker = stripEnding(marker.raw);
        entry.right.marker = stripEnding(marker.raw);
        entry.sources.push(i++);
      }

      result.push(entry);
    } else {
      result.push({
        full:
          row.text ===
          "Old | New | Diff (selected lines; original hunk headers)"
            ? {
                ...row,
                text: "Old (left) | New (right) · selected lines; original hunk headers",
              }
            : row,
        sources: [i++],
      });
    }
  }

  return result;
}
