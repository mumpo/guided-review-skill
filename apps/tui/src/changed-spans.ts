import type { DiffLine } from "../../../packages/core/src";
import { type FileRows, pairedFileRows } from "./diff";
import type { SyntaxSpan } from "./highlight";

/** Half-open UTF-16 offsets in source bodies (without signs or line endings). */
export interface ChangedRange {
  start: number;
  end: number;
}

export type ChangedSpans = Map<DiffLine, ChangedRange[]>;

// Compare whole Unicode words, retaining punctuation and whitespace segments verbatim.
const segmenter = new Intl.Segmenter("en", { granularity: "word" });

const comparisonBudget = 250_000;

export function compareLineSpans(oldText: string, newText: string) {
  const old = Array.from(segmenter.segment(oldText));
  const next = Array.from(segmenter.segment(newText));
  let start = 0;
  let oldEnd = old.length;
  let newEnd = next.length;

  while (
    start < oldEnd &&
    start < newEnd &&
    old[start].segment === next[start].segment
  )
    start++;

  while (
    oldEnd > start &&
    newEnd > start &&
    old[oldEnd - 1].segment === next[newEnd - 1].segment
  ) {
    oldEnd--;
    newEnd--;
  }

  const deleted: ChangedRange[] = [];
  const added: ChangedRange[] = [];
  const append = (ranges: ChangedRange[], from: number, to: number) => {
    if (from === to) return;

    const last = ranges.at(-1);
    if (last?.end === from) last.end = to;
    else ranges.push({ start: from, end: to });
  };

  const oldOffset = (i: number) => old[i]?.index ?? oldText.length;
  const newOffset = (i: number) => next[i]?.index ?? newText.length;

  const m = oldEnd - start;
  const n = newEnd - start;
  if (!m || !n || m * n > comparisonBudget) {
    append(deleted, oldOffset(start), oldOffset(oldEnd));
    append(added, newOffset(start), newOffset(newEnd));

    return { old: deleted, new: added };
  }

  const stride = n + 1;
  const lengths = new Uint32Array((m + 1) * stride);

  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lengths[i * stride + j] =
        old[start + i].segment === next[start + j].segment
          ? 1 + lengths[(i + 1) * stride + j + 1]
          : Math.max(
              lengths[(i + 1) * stride + j],
              lengths[i * stride + j + 1],
            );

  let i = 0;
  let j = 0;

  while (i < m || j < n) {
    if (i < m && j < n && old[start + i].segment === next[start + j].segment) {
      i++;
      j++;
    } else if (
      i < m &&
      (j === n || lengths[(i + 1) * stride + j] >= lengths[i * stride + j + 1])
    ) {
      append(deleted, oldOffset(start + i), oldOffset(start + i + 1));
      i++;
    } else {
      append(added, newOffset(start + j), newOffset(start + j + 1));
      j++;
    }
  }

  return { old: deleted, new: added };
}

export function changedFileSpans(file: FileRows): ChangedSpans {
  const result: ChangedSpans = new Map();

  for (const { left, right } of pairedFileRows(file)) {
    if (
      left?.role !== "deletion" ||
      right?.role !== "addition" ||
      !left.line ||
      !right.line
    )
      continue;

    const ranges = compareLineSpans(left.text.slice(1), right.text.slice(1));

    result.set(left.line, ranges.old);
    result.set(right.line, ranges.new);
  }

  return result;
}

/** Intersect syntax and change boundaries without changing source text. */
export function emphasizeSpans(spans: SyntaxSpan[], ranges: ChangedRange[]) {
  const result: (SyntaxSpan & { changed: boolean })[] = [];
  let offset = 0;
  let rangeIndex = 0;

  for (const span of spans) {
    const end = offset + span.text.length;
    let cursor = offset;

    while (cursor < end) {
      while (rangeIndex < ranges.length && ranges[rangeIndex].end <= cursor)
        rangeIndex++;

      const range = ranges[rangeIndex];
      const changed = !!range && range.start <= cursor;
      const boundary = Math.min(
        end,
        range ? (changed ? range.end : range.start) : end,
      );

      result.push({
        text: span.text.slice(cursor - offset, boundary - offset),
        color: span.color,
        changed,
      });
      cursor = boundary;
    }

    offset = end;
  }

  return result;
}
