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
