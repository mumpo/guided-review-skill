import type { DiffLine, ResolvedReference } from "../../../packages/core/src";

/** Merge overlapping references, retaining the captured file, hunk, and line order. */
export function renderSectionDiff(references: ResolvedReference[]): string {
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
  const blocks: string[] = [];
  for (const [{ file, diff }, selected] of files) {
    const path =
      file.oldPath && file.newPath && file.oldPath !== file.newPath
        ? `${file.oldPath} -> ${file.newPath}`
        : (file.newPath ?? file.oldPath);
    const rows = [`File: ${path} (${file.status})`];
    if (diff.kind === "binary") {
      rows.push("Binary file: textual diff is not available.");
    } else if (diff.kind === "unavailable") {
      rows.push(`Diff unavailable: ${diff.reason}`);
    } else {
      rows.push(...diff.header.map(stripEnding));
      if (diff.hunks.length === 0) {
        rows.push("Metadata-only change: no textual hunks.");
      } else {
        rows.push("Old | New | Diff (selected lines; original hunk headers)");
        let width = 3;
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
          if (omittedHunks) rows.push("... unreferenced hunks omitted ...");
          omittedHunks = false;
          rows.push(stripEnding(hunk.header));
          let omittedLines = false;
          for (const line of hunk.lines) {
            if (!selected.has(line)) {
              omittedLines = true;
              continue;
            }
            if (omittedLines) rows.push("... unreferenced lines omitted ...");
            omittedLines = false;
            const old = String(line.oldLine ?? "").padStart(width);
            const next = String(line.newLine ?? "").padStart(width);
            rows.push(`${old} | ${next} | ${stripEnding(line.raw)}`);
          }
          if (omittedLines) rows.push("... unreferenced lines omitted ...");
        }
        if (omittedHunks) rows.push("... unreferenced hunks omitted ...");
      }
    }
    blocks.push(rows.join("\n"));
  }
  return blocks.join("\n\n") || "(No referenced changes)";
}

function stripEnding(raw: string): string {
  return raw.replace(/\r?\n$/, "");
}
