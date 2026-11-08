import { parseKeypress } from "@opentui/core";
import { mountReview } from "./view";

/** Presentation tests exercise the full-width document through the public toggle. */
export function mountFullWidthReview(...args: Parameters<typeof mountReview>) {
  const applyTheme = mountReview(...args);
  if (args[0].width >= 110) {
    const key = parseKeypress("b");
    if (key) args[0].keyInput.processParsedKey(key);
  }
  return applyTheme;
}
