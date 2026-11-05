import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ThemePreference } from "./theme";

export const usage =
  "Usage: bun run dev:tui [--theme auto|github-light|github-dark] <path/to/review.json>";

function parseTheme(value: unknown, source: string): ThemePreference {
  if (value === "auto" || value === "github-light" || value === "github-dark")
    return value;
  throw new Error(
    `${source}: expected auto, github-light, or github-dark; received ${JSON.stringify(value)}.`,
  );
}

export function parseArgs(
  args: string[],
): { help: true } | { help: false; path: string; theme?: ThemePreference } {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
    return { help: true };
  let path: string | undefined;
  let theme: ThemePreference | undefined;
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && (arg === "--theme" || arg.startsWith("--theme="))) {
      if (theme !== undefined) throw new Error(`Duplicate --theme. ${usage}`);
      theme = parseTheme(
        arg === "--theme" ? args[++i] : arg.slice(8),
        "--theme",
      );
    } else if (!positionalOnly && arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}. ${usage}`);
    } else if (path === undefined) path = arg;
    else throw new Error(usage);
  }
  if (!path) throw new Error(usage);
  return { help: false, path, theme };
}

export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  return join(
    env.XDG_CONFIG_HOME || join(home, ".config"),
    "guided-review",
    "config.json",
  );
}

export async function loadThemePreference(
  cli: ThemePreference | undefined,
  env: NodeJS.ProcessEnv = process.env,
  path = configPath(env),
): Promise<ThemePreference> {
  let contents: string;
  let configured: ThemePreference | undefined;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Cannot read theme configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    contents = "{}";
  }
  try {
    const value: unknown = JSON.parse(contents);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected a JSON object");
    const config = value as Record<string, unknown>;
    const unknown = Object.keys(config).filter((key) => key !== "theme");
    if (unknown.length)
      throw new Error(`unknown configuration key(s): ${unknown.join(", ")}`);
    if (Object.hasOwn(config, "theme"))
      configured = parseTheme(config.theme, "theme");
  } catch (error) {
    throw new Error(
      `Invalid theme configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const environment =
    env.GUIDED_REVIEW_THEME === undefined
      ? undefined
      : parseTheme(env.GUIDED_REVIEW_THEME, "GUIDED_REVIEW_THEME");
  return cli ?? environment ?? configured ?? "auto";
}
