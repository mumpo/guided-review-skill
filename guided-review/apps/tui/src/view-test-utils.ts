import {
  parseKeypress,
  type CliRenderer,
  type Renderable,
} from "@opentui/core";
import { CursorText } from "./cursor-text";
import { DiffView } from "./diff-view";
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

/** Observe the cursor directly; navigation has no persistent heading. */
export function selectedDocumentPart(renderer: CliRenderer) {
  const selected = (node: Renderable): boolean => {
    if (node instanceof CursorText && node.selectedText) return true;
    if (node instanceof DiffView && node.hasCursor) return true;
    return node.getChildren().some(selected);
  };
  const body = renderer.root.findDescendantById("body");

  return body?.getChildren().findIndex(selected) ?? -1;
}
