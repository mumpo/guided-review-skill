import {
  RGBA,
  StyledText,
  TextRenderable,
  type ScrollBoxRenderable,
  type TextChunk,
  type CliRenderer,
  type TextOptions,
} from "@opentui/core";
import type { Theme } from "./theme";

export interface SearchRange {
  start: number;
  end: number;
}

/** Match without lowercasing the source, preserving UTF-16 offsets into chunks. */
export function searchRanges(text: string, query: string): SearchRange[] {
  const pattern = searchPattern(query);

  return pattern
    ? Array.from(text.matchAll(pattern), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
      }))
    : [];
}

function searchPattern(query: string) {
  const insensitive = query.includes("\\c");
  const literal = query.replaceAll("\\c", "");
  if (!literal) return undefined;

  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, insensitive ? "giu" : "gu");
}

export function searchChunks(
  chunks: TextChunk[],
  ranges: SearchRange[],
  focused: number | undefined,
  colors: Theme["search"],
): TextChunk[] {
  let offset = 0;
  let rangeIndex = 0;
  const result: TextChunk[] = [];

  for (const chunk of chunks) {
    const end = offset + chunk.text.length;
    let position = offset;
    while (position < end) {
      while (ranges[rangeIndex] && ranges[rangeIndex].end <= position)
        rangeIndex++;
      const range = ranges[rangeIndex];
      const matched = range && range.start <= position;
      const next = Math.min(
        end,
        range ? (matched ? range.end : range.start) : end,
      );
      const color = rangeIndex === focused ? colors.focused : colors.match;

      result.push({
        ...chunk,
        text: chunk.text.slice(position - offset, next - offset),
        ...(matched
          ? {
              fg: RGBA.fromHex(color.foreground),
              bg: RGBA.fromHex(color.background),
            }
          : {}),
      });
      position = next;
    }
    offset = end;
  }

  return result;
}

/** Keeps the unmodified style so live syntax/theme updates cannot erase search. */
export class SearchText extends TextRenderable {
  static revision = 0;
  private sourceText?: string;
  private original?: StyledText;
  private ranges: SearchRange[] = [];
  private focusedRange?: number;
  private colors?: Theme["search"];

  constructor(renderer: CliRenderer, options: TextOptions) {
    super(renderer, options);
    this.content = options.content ?? "";
  }

  override get content(): StyledText {
    return this.original ?? super.content;
  }

  override set content(value: StyledText | string) {
    const text =
      typeof value === "string"
        ? value
        : value.chunks.map((chunk) => chunk.text).join("");
    if (text !== this.sourceText) {
      this.sourceText = text;
      SearchText.revision++;
    }
    this.original =
      typeof value === "string"
        ? new StyledText([{ __isChunk: true, text: value }])
        : value;
    this.paintSearch();
  }

  setSearch(
    ranges: SearchRange[],
    focused: number | undefined,
    colors: Theme["search"],
  ) {
    if (this.isDestroyed) return;

    this.ranges = ranges;
    this.focusedRange = focused;
    this.colors = colors;
    this.paintSearch();
  }

  protected override destroySelf() {
    SearchText.revision++;
    super.destroySelf();
  }

  private paintSearch() {
    if (!this.original) return;

    super.content =
      this.colors && this.ranges?.length
        ? new StyledText(
            searchChunks(
              this.original.chunks,
              this.ranges,
              this.focusedRange,
              this.colors,
            ),
          )
        : this.original;
  }
}

export interface SearchTarget {
  id: string;
  text: string;
  node: SearchText;
  offset: number;
  focus: (offset: number) => void;
  selected: () => boolean;
  mirrors?: { node: SearchText; offset: number }[];
}

export interface SearchMatch {
  target: SearchTarget;
  range: SearchRange;
}

/** Indexes semantic occurrences once, rather than duplicated layout cells. */
export class DocumentSearch {
  query = "";
  matches: SearchMatch[] = [];
  focused?: SearchMatch;
  private cache = new Map<
    string,
    { text: string; query: string; ranges: SearchRange[] }
  >();
  private painted = new Map<SearchText, string>();

  update(targets: SearchTarget[], colors: Theme["search"]) {
    const old = this.focused;
    const pattern = searchPattern(this.query);
    this.matches = [];
    const live = new Set<string>();
    const painting = new Map<
      SearchText,
      { ranges: SearchRange[]; focused?: number }
    >();
    for (const target of targets) {
      live.add(target.id);
      let entry = this.cache.get(target.id);
      if (!entry || entry.text !== target.text || entry.query !== this.query) {
        entry = {
          text: target.text,
          query: this.query,
          ranges: pattern
            ? Array.from(target.text.matchAll(pattern), (match) => ({
                start: match.index,
                end: match.index + match[0].length,
              }))
            : [],
        };
        this.cache.set(target.id, entry);
      }
      const paint = painting.get(target.node) ?? { ranges: [] };
      for (const range of entry.ranges) {
        const match = { target, range };
        this.matches.push(match);
        if (old?.target.id === target.id && old.range.start === range.start) {
          this.focused = match;
          paint.focused = paint.ranges.length;
        }
        paint.ranges.push({
          start: range.start + target.offset,
          end: range.end + target.offset,
        });
      }
      painting.set(target.node, paint);
      for (const mirror of target.mirrors ?? []) {
        painting.set(mirror.node, {
          ranges: entry.ranges.map((range) => ({
            start: range.start + mirror.offset,
            end: range.end + mirror.offset,
          })),
          focused: paint.focused,
        });
      }
    }
    if (this.focused && !this.matches.includes(this.focused))
      this.focused = undefined;
    for (const id of this.cache.keys())
      if (!live.has(id)) this.cache.delete(id);
    for (const [node] of this.painted) {
      if (!painting.has(node)) {
        if (!node.isDestroyed) node.setSearch([], undefined, colors);
        this.painted.delete(node);
      }
    }
    for (const [node, paint] of painting) {
      const signature = JSON.stringify([paint, colors]);
      if (this.painted.get(node) !== signature) {
        node.setSearch(paint.ranges, paint.focused, colors);
        this.painted.set(node, signature);
      }
    }
  }

  navigate(targets: SearchTarget[], direction: 1 | -1, initial = false) {
    if (!this.matches.length) return;

    const order = new Map(targets.map((target, index) => [target, index]));
    const selected = targets.findIndex((target) => target.selected());
    const current = this.focused?.target.selected()
      ? this.matches.indexOf(this.focused)
      : -1;
    let next: number;
    if (!initial && current >= 0) next = current + direction;
    else if (direction > 0) {
      next = this.matches.findIndex(
        (match) => (order.get(match.target) ?? -1) >= selected,
      );
      if (next < 0) next = 0;
    } else {
      next = -1;
      for (let index = 0; index < this.matches.length; index++) {
        if ((order.get(this.matches[index].target) ?? -1) <= selected)
          next = index;
      }
      if (next < 0) next = this.matches.length - 1;
    }
    this.focused =
      this.matches[(next + this.matches.length) % this.matches.length];
    this.focused.target.focus(this.focused.range.start);
  }
}

/** Reveal the matching visual continuation rather than the beginning of a long row. */
export function revealSearch(
  body: ScrollBoxRenderable,
  node: SearchText,
  offset: number,
) {
  body.afterLayout(() => {
    if (body.isDestroyed || node.isDestroyed) return;

    const prefix = node.plainText.slice(0, offset).split("\n");
    const logical = prefix.length - 1;
    let column = 0;
    prefix[logical].split("\t").forEach((segment, index) => {
      if (index) column += 4 - (column % 4);
      column += Bun.stringWidth(segment);
    });
    const info = node.lineInfo;
    let visual = 0;
    for (let index = 0; index < info.lineSources.length; index++) {
      if (
        info.lineSources[index] === logical &&
        info.lineStartCols[index] <= column
      )
        visual = index;
    }
    const y = node.y + visual;
    if (y < body.viewport.y) body.scrollBy(y - body.viewport.y);
    else if (y >= body.viewport.y + body.viewport.height)
      body.scrollBy(y - body.viewport.y - body.viewport.height + 1);
  });
}
