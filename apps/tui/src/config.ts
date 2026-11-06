import type {
  DiffMode,
  ThemePreference,
} from "../../../packages/preferences/src";
import { parseTheme, parseDiffMode } from "../../../packages/preferences/src";
export {
  configPath,
  loadPreferences,
  loadThemePreference,
} from "../../../packages/preferences/src";

export const usage =
  "Usage: bun run dev:tui [--config PATH] [--theme auto|github-light|github-dark] [--diff-mode auto|inline|side-by-side] <path/to/review.json>";

export function parseArgs(args: string[]):
  | { help: true }
  | {
      help: false;
      path: string;
      config?: string;
      theme?: ThemePreference;
      diffMode?: DiffMode;
    } {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
    return { help: true };

  let path: string | undefined;
  let config: string | undefined;
  let theme: ThemePreference | undefined;
  let diffMode: DiffMode | undefined;
  let positionalOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (
      !positionalOnly &&
      (arg === "--config" || arg.startsWith("--config="))
    ) {
      if (config !== undefined) throw new Error(`Duplicate --config. ${usage}`);
      config = arg === "--config" ? args[++i] : arg.slice(9);
      if (!config || config.startsWith("--"))
        throw new Error(`Missing --config path. ${usage}`);
    } else if (
      !positionalOnly &&
      (arg === "--theme" || arg.startsWith("--theme="))
    ) {
      if (theme !== undefined) throw new Error(`Duplicate --theme. ${usage}`);

      theme = parseTheme(
        arg === "--theme" ? args[++i] : arg.slice(8),
        "--theme",
      );
    } else if (
      !positionalOnly &&
      (arg === "--diff-mode" || arg.startsWith("--diff-mode="))
    ) {
      if (diffMode !== undefined)
        throw new Error(`Duplicate --diff-mode. ${usage}`);

      diffMode = parseDiffMode(
        arg === "--diff-mode" ? args[++i] : arg.slice(12),
        "--diff-mode",
      );
    } else if (!positionalOnly && arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}. ${usage}`);
    } else if (path === undefined) path = arg;
    else throw new Error(usage);
  }

  if (!path) throw new Error(usage);

  return {
    help: false,
    path,
    ...(config === undefined ? {} : { config }),
    theme,
    ...(diffMode === undefined ? {} : { diffMode }),
  };
}
