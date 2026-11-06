import { RGBA } from "@opentui/core";
import type { ThemeName } from "./theme";

/** Shift existing row, gutter, and word colors together to retain diff semantics. */
export function cursorBackground(
  color: string | RGBA,
  theme: ThemeName,
): string {
  const base = typeof color === "string" ? RGBA.fromHex(color) : color;
  const dark = theme === "github-dark";
  const target = dark ? 255 : 0;
  const amount = dark ? 0.08 : 0.06;
  const channels = base
    .toInts()
    .slice(0, 3)
    .map((value) =>
      Math.round(value + (target - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    );

  return `#${channels.join("")}`;
}
