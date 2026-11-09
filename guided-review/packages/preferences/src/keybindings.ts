/** Ordered defaults; explicit configuration assignments are applied afterwards. */
export const defaultKeybindings = {
  next_section: ["ctrl+n"],
  previous_section: ["ctrl+p"],
  next_item: ["tab"],
  previous_item: ["shift+tab"],
  summary: ["s", "home"],
  last_section: ["end"],
  cursor_down: ["j"],
  cursor_up: ["k"],
  scroll_down: ["down"],
  scroll_up: ["up"],
  page_down: ["pagedown"],
  page_up: ["pageup"],
  half_page_down: ["ctrl+d"],
  half_page_up: ["ctrl+u"],
  switch_side: ["space"],
  open_comment: ["c"],
  toggle_file: ["z"],
  cycle_diff_mode: ["d"],
  toggle_sidebar: ["b"],
  toggle_help: ["?"],
  open_search: ["/"],
  clear_search: ["escape"],
  submit_search: ["return"],
  next_match: ["n"],
  previous_match: ["shift+n"],
  quit: ["q"],
  interrupt: ["ctrl+c"],
  close_comment: ["escape"],
  publish_comment: ["ctrl+s"],
} satisfies Record<string, string[]>;

export type KeyAction = keyof typeof defaultKeybindings;
export type Keybindings = Record<KeyAction, string[]>;
export type KeyContext = "viewer" | "editor" | "search";

const modifiers = ["ctrl", "alt", "shift", "meta"];
const namedKeys = new Set([
  "tab",
  "home",
  "end",
  "up",
  "down",
  "left",
  "right",
  "pageup",
  "pagedown",
  "space",
  "escape",
  "return",
  "backspace",
  "delete",
  "insert",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

export function normalizeBinding(value: string): string {
  const parts = value.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((part) => (part === "option" ? "alt" : part));
  if (
    (!/^[a-z0-9?/]$/.test(key) && !namedKeys.has(key)) ||
    mods.some((mod) => !modifiers.includes(mod)) ||
    new Set(mods).size !== mods.length
  )
    throw new Error(`invalid key binding ${JSON.stringify(value)}`);

  return [...modifiers.filter((mod) => mods.includes(mod)), key].join("+");
}

function contexts(action: KeyAction): KeyContext[] {
  if (action === "interrupt") return ["viewer", "editor", "search"];
  if (action === "submit_search") return ["search"];
  if (action === "clear_search") return ["viewer", "search"];
  if (action === "close_comment" || action === "publish_comment")
    return ["editor"];
  return ["viewer"];
}

// Multi-context actions can retain a key in one context while losing another.
const resolvedContexts = new WeakMap<
  Keybindings,
  Record<KeyContext, Map<string, KeyAction>>
>();

export function resolveKeybindings(value: unknown = {}): Keybindings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("tui.keybindings: expected a table");

  const overrides = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.keys(defaultKeybindings).map((key) => [key, []]),
  ) as unknown as Keybindings;
  const assignments: [KeyAction, string[]][] = [];
  for (const [name, bindings] of Object.entries(defaultKeybindings)) {
    if (!Object.hasOwn(overrides, name))
      assignments.push([name as KeyAction, bindings]);
  }
  for (const [name, bindings] of Object.entries(overrides)) {
    if (!Object.hasOwn(defaultKeybindings, name))
      throw new Error(`tui.keybindings: unknown action ${name}`);
    if (
      !Array.isArray(bindings) ||
      bindings.some((binding) => typeof binding !== "string")
    )
      throw new Error(
        `tui.keybindings.${name}: expected an array of key strings`,
      );
    assignments.push([name as KeyAction, bindings]);
  }
  // Each context has its own winner. This preserves a viewer binding when only
  // its editor-context counterpart is displaced by a later assignment.
  const winners: Record<KeyContext, Map<string, KeyAction>> = {
    viewer: new Map(),
    editor: new Map(),
    search: new Map(),
  };
  for (const [action, bindings] of assignments) {
    for (const binding of bindings) {
      let normalized: string;
      try {
        normalized = normalizeBinding(binding);
      } catch (error) {
        throw new Error(
          `tui.keybindings.${action}: ${(error as Error).message}`,
        );
      }
      for (const context of contexts(action))
        winners[context].set(normalized, action);
    }
  }
  for (const [action, bindings] of assignments) {
    result[action] = [...new Set(bindings.map(normalizeBinding))].filter(
      (binding) =>
        contexts(action).some(
          (context) => winners[context].get(binding) === action,
        ),
    );
  }
  resolvedContexts.set(result, winners);
  return result;
}

/** A global binding may survive only in the other input context. */
export function actionKeys(
  bindings: Keybindings,
  action: KeyAction,
  context: KeyContext,
): string[] {
  if (!contexts(action).includes(context)) return [];
  const winners = resolvedContexts.get(bindings)?.[context];
  if (winners)
    return bindings[action].filter(
      (binding) => winners.get(binding) === action,
    );

  return bindings[action].filter(
    (binding) =>
      action !== "interrupt" ||
      !(Object.keys(bindings) as KeyAction[]).some(
        (other) =>
          other !== "interrupt" &&
          contexts(other).includes(context) &&
          bindings[other].includes(binding),
      ),
  );
}

export interface KeyInput {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  option?: boolean;
}

export function keyAction(
  bindings: Keybindings,
  key: KeyInput,
  context: KeyContext,
): KeyAction | undefined {
  let normalized: string;
  try {
    normalized = normalizeBinding(
      [
        ...(key.ctrl ? ["ctrl"] : []),
        ...(key.option ? ["alt"] : []),
        ...(key.shift || /^[A-Z]$/.test(key.name) ? ["shift"] : []),
        ...(key.meta ? ["meta"] : []),
        key.name,
      ].join("+"),
    );
  } catch {
    return undefined;
  }

  const winners = resolvedContexts.get(bindings)?.[context];
  if (winners) return winners.get(normalized);

  // An explicit context action takes priority over a global interrupt whose
  // binding survived in the other context.
  return (
    (Object.keys(bindings) as KeyAction[]).find(
      (action) =>
        action !== "interrupt" &&
        contexts(action).includes(context) &&
        bindings[action].includes(normalized),
    ) ?? (bindings.interrupt.includes(normalized) ? "interrupt" : undefined)
  );
}
