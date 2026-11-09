import { expect, test } from "bun:test";
import {
  actionKeys,
  keyAction,
  normalizeBinding,
  resolveKeybindings,
} from "./keybindings";

test("defaults, partial replacement, and disabling", () => {
  const defaults = resolveKeybindings();
  expect(defaults.next_section).toEqual(["ctrl+n"]);
  expect(defaults.next_item).toEqual(["tab"]);
  const bindings = resolveKeybindings({ next_section: ["x"], quit: [] });
  expect(bindings.next_section).toEqual(["x"]);
  expect(bindings.quit).toEqual([]);
  expect(bindings.previous_section).toEqual(defaults.previous_section);
  expect(
    keyAction(bindings, { name: "n", ctrl: true }, "viewer"),
  ).toBeUndefined();
});

test("last normalized assignment wins over defaults and earlier explicit assignments", () => {
  const bindings = resolveKeybindings({
    next_section: ["x", "Shift+CTRL+N"],
    cursor_down: ["x", "j"],
    toggle_file: ["x", "ctrl+shift+n", "tab"],
  });
  expect(bindings.next_section).toEqual([]);
  expect(bindings.cursor_down).toEqual(["j"]);
  expect(bindings.next_item).toEqual([]);
  expect(bindings.toggle_file).toEqual(["x", "ctrl+shift+n", "tab"]);
  expect(
    keyAction(bindings, { name: "n", ctrl: true, shift: true }, "viewer"),
  ).toBe("toggle_file");
  expect(
    resolveKeybindings({ toggle_file: ["x"], cursor_down: ["x"] }).toggle_file,
  ).toEqual([]);
  expect(
    resolveKeybindings({ cursor_down: [], toggle_file: ["j"] }).cursor_down,
  ).toEqual([]);
});

test("editor bindings reuse viewer keys and global interrupts obey assignment order", () => {
  const bindings = resolveKeybindings({
    next_section: ["x"],
    close_comment: ["x"],
  });
  expect(keyAction(bindings, { name: "x" }, "viewer")).toBe("next_section");
  expect(keyAction(bindings, { name: "x" }, "editor")).toBe("close_comment");
  const localWins = resolveKeybindings({
    interrupt: ["ctrl+x"],
    publish_comment: ["ctrl+x"],
  });
  expect(keyAction(localWins, { name: "x", ctrl: true }, "viewer")).toBe(
    "interrupt",
  );
  expect(keyAction(localWins, { name: "x", ctrl: true }, "editor")).toBe(
    "publish_comment",
  );
  const globalWins = resolveKeybindings({
    publish_comment: ["ctrl+x"],
    interrupt: ["ctrl+x"],
  });
  expect(actionKeys(localWins, "interrupt", "editor")).toEqual([]);
  expect(actionKeys(localWins, "interrupt", "viewer")).toEqual(["ctrl+x"]);
  expect(globalWins.publish_comment).toEqual([]);
  expect(keyAction(globalWins, { name: "x", ctrl: true }, "editor")).toBe(
    "interrupt",
  );
  expect(
    keyAction(
      resolveKeybindings({ interrupt: [] }),
      { name: "c", ctrl: true },
      "viewer",
    ),
  ).toBeUndefined();
});

test("key notation normalizes case and modifier order and rejects malformed values", () => {
  expect(normalizeBinding("META+Shift+OPTION+CTRL+F12")).toBe(
    "ctrl+alt+shift+meta+f12",
  );
  for (const binding of [
    "",
    "ctrl+ctrl+n",
    "ctrl+",
    "super+x",
    "gg",
    "n p",
    "ctrl+unknown",
  ]) {
    expect(() => normalizeBinding(binding)).toThrow();
  }
  for (const value of [
    null,
    [],
    "x",
    { unknown_action: ["x"] },
    { next_item: "x" },
    { next_item: [1] },
    { next_item: ["bad"] },
  ]) {
    expect(() => resolveKeybindings(value)).toThrow("tui.keybindings");
  }
});

test("search bindings isolate input, normalize slash and uppercase events, and resolve conflicts", () => {
  const bindings = resolveKeybindings();

  expect(normalizeBinding("/")).toBe("/");
  expect(keyAction(bindings, { name: "/" }, "viewer")).toBe("open_search");
  expect(keyAction(bindings, { name: "N", shift: true }, "viewer")).toBe(
    "previous_match",
  );
  expect(keyAction(bindings, { name: "n" }, "search")).toBeUndefined();
  expect(keyAction(bindings, { name: "q" }, "search")).toBeUndefined();
  expect(keyAction(bindings, { name: "return" }, "search")).toBe(
    "submit_search",
  );
  expect(keyAction(bindings, { name: "escape" }, "search")).toBe(
    "clear_search",
  );
  expect(keyAction(bindings, { name: "escape" }, "editor")).toBe(
    "close_comment",
  );
  expect(keyAction(bindings, { name: "c", ctrl: true }, "search")).toBe(
    "interrupt",
  );
  const custom = resolveKeybindings({
    interrupt: ["ctrl+x"],
    submit_search: ["ctrl+x"],
    open_search: ["f"],
    cursor_down: ["n"],
  });

  expect(actionKeys(custom, "interrupt", "search")).toEqual([]);
  expect(keyAction(custom, { name: "x", ctrl: true }, "search")).toBe(
    "submit_search",
  );
  expect(keyAction(custom, { name: "x", ctrl: true }, "viewer")).toBe(
    "interrupt",
  );
  expect(custom.next_match).toEqual([]);
  expect(keyAction(custom, { name: "f" }, "viewer")).toBe("open_search");
});

test("clear_search can lose a binding independently in viewer and search contexts", () => {
  const searchWins = resolveKeybindings({ submit_search: ["escape"] });
  expect(actionKeys(searchWins, "clear_search", "search")).toEqual([]);
  expect(actionKeys(searchWins, "clear_search", "viewer")).toEqual(["escape"]);
  expect(keyAction(searchWins, { name: "escape" }, "search")).toBe(
    "submit_search",
  );
  expect(keyAction(searchWins, { name: "escape" }, "viewer")).toBe(
    "clear_search",
  );

  const viewerWins = resolveKeybindings({ quit: ["escape"] });
  expect(actionKeys(viewerWins, "clear_search", "viewer")).toEqual([]);
  expect(actionKeys(viewerWins, "clear_search", "search")).toEqual(["escape"]);
  expect(keyAction(viewerWins, { name: "escape" }, "search")).toBe(
    "clear_search",
  );
  expect(keyAction(viewerWins, { name: "escape" }, "viewer")).toBe("quit");
  expect(keyAction(viewerWins, { name: "N" }, "viewer")).toBe("previous_match");
});

test("reaction keys normalize literal plus and isolate picker closing from search and editor", () => {
  const bindings = resolveKeybindings();

  expect(keyAction(bindings, { name: "+" }, "viewer")).toBe("open_reactions");
  expect(keyAction(bindings, { name: "=", shift: true }, "viewer")).toBe(
    "open_reactions",
  );
  expect(keyAction(bindings, { name: "plus", shift: true }, "viewer")).toBe(
    "open_reactions",
  );
  expect(keyAction(bindings, { name: "escape" }, "reactions")).toBe(
    "close_reactions",
  );
  expect(keyAction(bindings, { name: "escape" }, "viewer")).toBe(
    "clear_search",
  );
  expect(keyAction(bindings, { name: "r" }, "reactions")).toBeUndefined();
  expect(
    keyAction(bindings, { name: "+", ctrl: true }, "viewer"),
  ).toBeUndefined();
  expect(keyAction(bindings, { name: "c", ctrl: true }, "reactions")).toBe(
    "interrupt",
  );

  const custom = resolveKeybindings({
    open_reactions: ["a"],
    close_reactions: ["x"],
  });
  expect(keyAction(custom, { name: "+" }, "viewer")).toBeUndefined();
  expect(keyAction(custom, { name: "a" }, "viewer")).toBe("open_reactions");
  expect(keyAction(custom, { name: "x" }, "reactions")).toBe("close_reactions");
});
