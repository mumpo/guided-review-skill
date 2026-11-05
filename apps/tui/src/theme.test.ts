import { expect, test } from "bun:test";
import { diffGutterBackground, themes } from "./theme";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("theme text pairs meet a 4.5:1 contrast ratio", () => {
  for (const theme of Object.values(themes)) {
    const pairs = [
      [theme.text, theme.background],
      [theme.muted, theme.surface],
      [theme.navigation.foreground, theme.navigation.background],
      [theme.scrollbar.foreground, theme.scrollbar.background],
      [theme.diff.text, theme.diff.background],
      [theme.diff.addition.foreground, theme.diff.addition.background],
      [theme.diff.deletion.foreground, theme.diff.deletion.background],
      [theme.diff.addition.foreground, diffGutterBackground(theme, "addition")],
      [theme.diff.deletion.foreground, diffGutterBackground(theme, "deletion")],
      [theme.diff.lineNumber, theme.surface],
      ...[
        theme.diff.context,
        theme.diff.hunk,
        theme.diff.file,
        theme.diff.lineNumber,
        theme.diff.marker,
      ].map((fg) => [fg, theme.diff.background]),
      [theme.diagram.foreground, theme.diagram.background],
      [theme.diagram.accent, theme.diagram.background],
      ...[theme.markdown.text, theme.markdown.heading, theme.markdown.link].map(
        (fg) => [fg, theme.background],
      ),
      [theme.markdown.code, theme.markdown.codeBackground],
    ];
    for (const [fg, bg] of pairs) {
      const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
});

test("GitHub gutter colors retain alpha values and resolve over the diff canvas", () => {
  const light = themes["github-light"];
  const dark = themes["github-dark"];
  expect(light.diff.addition.gutterBackground).toBe("#aceebb");
  expect(light.diff.deletion.gutterBackground).toBe("#ffcecb");
  expect(dark.diff.addition.gutterBackground).toBe("#2ea04366");
  expect(dark.diff.deletion.gutterBackground).toBe("#f8514966");
  expect(diffGutterBackground(light, "addition")).toBe("#aceebb");
  expect(diffGutterBackground(light, "deletion")).toBe("#ffcecb");
  expect(diffGutterBackground(dark, "addition")).toBe("#1a4a29");
  expect(diffGutterBackground(dark, "deletion")).toBe("#6b2b2b");
});
