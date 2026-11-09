import { resolveKeybindings, type Keybindings } from "./keybindings";
import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export * from "./keybindings";

export type ThemeName = "github-light" | "github-dark";
export type ThemePreference = ThemeName | "auto";
export type DiffMode = "auto" | "inline" | "side-by-side";
export const launchTargets = [
  "auto",
  "terminal-window",
  "tmux-window",
  "tmux-pane",
  "tmux-popup",
  "herdr-tab",
  "herdr-pane",
  "custom",
] as const;
export type LaunchTarget = (typeof launchTargets)[number];

export interface Preferences {
  configFile: string;
  keybindings: Keybindings;
  viewer: "tui";
  autoOpen: boolean;
  theme: ThemePreference;
  lightTheme: ThemeName;
  darkTheme: ThemeName;
  diffMode: DiffMode;
  commentsUnfolded: boolean;
  launch: LaunchTarget;
  pane: { direction: "right" | "down"; size: number };
  popup: { width: number; height: number };
  custom?: string[];
}

function choice<T extends string>(
  value: unknown,
  values: readonly T[],
  source: string,
): T {
  if (typeof value === "string" && values.includes(value as T))
    return value as T;

  throw new Error(
    `${source}: expected ${values.join(", ")}; received ${JSON.stringify(value)}.`,
  );
}

export function parseTheme(value: unknown, source: string): ThemePreference {
  return choice(value, ["auto", "github-light", "github-dark"], source);
}

export function parseDiffMode(value: unknown, source: string): DiffMode {
  return choice(value, ["auto", "inline", "side-by-side"], source);
}

function table(
  value: unknown,
  keys: string[],
  source: string,
): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${source}: expected a table`);

  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).filter((key) => !keys.includes(key));
  if (unknown.length)
    throw new Error(
      `${source}: unknown configuration key(s): ${unknown.join(", ")}`,
    );

  return result;
}

function percentage(value: unknown, fallback: number, source: string): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 99
  )
    throw new Error(`${source}: expected an integer from 1 to 99`);

  return value;
}

export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  return resolve(
    env.GUIDED_REVIEW_CONFIG ??
      join(
        env.XDG_CONFIG_HOME || join(home, ".config"),
        "guided-review",
        "config.toml",
      ),
  );
}

export async function loadPreferences(
  cli: { theme?: ThemePreference; diffMode?: DiffMode; config?: string },
  env: NodeJS.ProcessEnv = process.env,
  path = cli.config ? resolve(cli.config) : configPath(env),
): Promise<Preferences> {
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      cli.config !== undefined ||
      env.GUIDED_REVIEW_CONFIG !== undefined
    ) {
      throw new Error(
        `Cannot read viewer configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const legacy = join(dirname(path), "config.json");
    let exists = false;
    try {
      await access(legacy);
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (exists)
      throw new Error(
        `Migrate ${legacy} to ${path}: use [tui] with theme and diff_mode in TOML. JSON configuration is no longer supported.`,
      );
  }

  try {
    const root = table(
      Bun.TOML.parse(contents),
      ["viewer", "auto_open", "tui"],
      "config",
    );
    if (root.viewer === "web")
      throw new Error('viewer = "web" is not implemented; use "tui".');
    if (root.viewer !== undefined) choice(root.viewer, ["tui"], "viewer");
    if (root.auto_open !== undefined && typeof root.auto_open !== "boolean")
      throw new Error("auto_open: expected a boolean");

    const tui = table(
      root.tui,
      [
        "keybindings",
        "theme",
        "light_theme",
        "dark_theme",
        "diff_mode",
        "comments_unfolded",
        "launch",
        "pane",
        "popup",
        "custom",
      ],
      "tui",
    );
    if (
      tui.comments_unfolded !== undefined &&
      typeof tui.comments_unfolded !== "boolean"
    )
      throw new Error("tui.comments_unfolded: expected a boolean");

    const pane = table(tui.pane, ["direction", "size"], "tui.pane");
    const popup = table(tui.popup, ["width", "height"], "tui.popup");
    const custom = table(tui.custom, ["command"], "tui.custom");
    let command: string[] | undefined;
    if (custom.command !== undefined) {
      const value = custom.command;
      if (
        !Array.isArray(value) ||
        value.length < 2 ||
        value.some((part) => typeof part !== "string" || part.includes("\0")) ||
        !value[0] ||
        value[0] === "{viewer}" ||
        value.filter((part) => part === "{viewer}").length !== 1 ||
        value.some((part) => part !== "{viewer}" && part.includes("{viewer}"))
      )
        throw new Error(
          "tui.custom.command: expected an executable and arguments with one standalone {viewer} entry",
        );
      command = value;
    }

    const configuredTheme = parseTheme(tui.theme ?? "auto", "tui.theme");
    const configuredDiff = parseDiffMode(
      tui.diff_mode ?? "auto",
      "tui.diff_mode",
    );
    const launch = choice(tui.launch ?? "auto", launchTargets, "tui.launch");
    if (launch === "custom" && !command)
      throw new Error("tui.custom.command is required for custom launch");
    const environment =
      env.GUIDED_REVIEW_THEME === undefined
        ? undefined
        : parseTheme(env.GUIDED_REVIEW_THEME, "GUIDED_REVIEW_THEME");

    return {
      configFile: resolve(path),
      keybindings: resolveKeybindings(tui.keybindings),
      viewer: "tui",
      autoOpen: (root.auto_open as boolean | undefined) ?? true,
      theme: cli.theme ?? environment ?? configuredTheme,
      diffMode: cli.diffMode ?? configuredDiff,
      commentsUnfolded: (tui.comments_unfolded as boolean | undefined) ?? false,
      lightTheme: choice(
        tui.light_theme ?? "github-light",
        ["github-light", "github-dark"],
        "tui.light_theme",
      ),
      darkTheme: choice(
        tui.dark_theme ?? "github-dark",
        ["github-light", "github-dark"],
        "tui.dark_theme",
      ),
      launch,
      pane: {
        direction: choice(
          pane.direction ?? "right",
          ["right", "down"],
          "tui.pane.direction",
        ),
        size: percentage(pane.size, 50, "tui.pane.size"),
      },
      popup: {
        width: percentage(popup.width, 90, "tui.popup.width"),
        height: percentage(popup.height, 90, "tui.popup.height"),
      },
      custom: command,
    };
  } catch (error) {
    throw new Error(
      `Invalid viewer configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadThemePreference(
  cli: ThemePreference | undefined,
  env: NodeJS.ProcessEnv = process.env,
  path = configPath(env),
): Promise<ThemePreference> {
  return (await loadPreferences({ theme: cli }, env, path)).theme;
}
