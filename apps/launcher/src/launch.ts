import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  LaunchTarget,
  Preferences,
} from "../../../packages/preferences/src";

export interface Request {
  argv: string[];
  cwd: string;
  detached?: boolean;
}
export type Run = (request: Request) => Promise<string>;

/** Quote only at boundaries whose API requires a shell string. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export const run: Run = async ({ argv, cwd, detached }) => {
  // Detached launchers may keep writing after this helper exits. A temporary
  // file avoids broken output pipes while retaining immediate startup errors.
  const logDirectory = detached
    ? await mkdtemp(join(tmpdir(), "review-launch-"))
    : undefined;
  const logPath = logDirectory ? join(logDirectory, "stderr") : undefined;
  const log = logPath ? await open(logPath, "wx", 0o600) : undefined;
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    detached,
    stdio: ["ignore", detached ? "ignore" : "pipe", log ? log.fd : "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data) => {
    stdout += data;
  });
  child.stderr?.on("data", (data) => {
    stderr = (stderr + data).slice(-65536);
  });

  return new Promise<string>((resolveResult, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = async (error?: Error, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (detached) child.unref();

      try {
        if (logPath && failure)
          stderr = (await readFile(logPath, "utf8")).slice(-65536);
        if (log) await log.close();
        if (logDirectory)
          await rm(logDirectory, { recursive: true, force: true });
        if (error) reject(error);
        else if (failure)
          reject(new Error(`${argv[0]} failed (${failure}): ${stderr.trim()}`));
        else resolveResult(stdout);
      } catch (cleanupError) {
        reject(cleanupError);
      }
    };

    child.on("error", (error) => {
      void finish(error);
    });
    child.on("close", (code, signal) => {
      void finish(undefined, code === 0 ? undefined : String(signal ?? code));
    });
    child.on("spawn", () => {
      // Detached adapters may live for the whole review; only observe immediate errors.
      if (detached)
        timer = setTimeout(() => {
          void finish();
        }, 250);
    });
  });
};

export function selectTarget(
  preference: LaunchTarget,
  env: NodeJS.ProcessEnv,
  platform: string,
): Exclude<LaunchTarget, "auto"> {
  if (preference !== "auto") return preference;
  if ((env.HERDR_PANE_ID || env.HERDR_ACTIVE_PANE_ID) && env.HERDR_WORKSPACE_ID)
    return "herdr-tab";
  if (env.TMUX && env.TMUX_PANE) return "tmux-window";
  if (platform === "darwin" && !env.SSH_CONNECTION && !env.SSH_TTY)
    return "terminal-window";

  throw new Error(
    "No supported terminal detected. Configure tui.launch and optionally tui.custom.command in config.toml.",
  );
}

export function viewerCommand(
  preferences: Preferences,
  artifact: string,
): string[] {
  const entry = resolve(import.meta.dir, "../../tui/src/index.ts");

  return [
    process.execPath,
    entry,
    ...(existsSync(preferences.configFile)
      ? ["--config", preferences.configFile]
      : []),
    "--theme",
    preferences.theme,
    "--diff-mode",
    preferences.diffMode,
    "--",
    resolve(artifact),
  ];
}

export async function launch(
  preferences: Preferences,
  artifact: string,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: string;
    run?: Run;
    cwd?: string;
  } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execute = options.run ?? run;
  const cwd = options.cwd ?? process.cwd();
  const target = selectTarget(preferences.launch, env, platform);
  const viewer = viewerCommand(preferences, artifact);
  const command = viewer.map(shellQuote).join(" ");
  const invoke = (argv: string[], detached = false) =>
    execute({ argv, cwd, detached });

  if (target === "custom") {
    if (!preferences.custom) throw new Error("tui.custom.command is required");
    await invoke(
      preferences.custom.flatMap((part) =>
        part === "{viewer}" ? viewer : [part],
      ),
      true,
    );
  } else if (target === "terminal-window") {
    if (platform !== "darwin")
      throw new Error(
        "terminal-window currently requires macOS; configure a custom launcher for your terminal.",
      );
    if (env.SSH_CONNECTION || env.SSH_TTY)
      throw new Error(
        "Cannot open a local Terminal window from an SSH session; configure tmux, Herdr, or a custom launcher.",
      );

    // AppleScript string escaping is separate from shell quoting.
    const literal = JSON.stringify(`cd ${shellQuote(cwd)} && ${command}`);
    await invoke([
      "osascript",
      "-e",
      `tell application "Terminal"\nactivate\ndo script ${literal}\nend tell`,
    ]);
  } else if (target.startsWith("tmux-")) {
    if (!env.TMUX || !env.TMUX_PANE)
      throw new Error(
        `${target} requires a calling tmux pane (TMUX and TMUX_PANE).`,
      );
    const pane = env.TMUX_PANE;
    if (target === "tmux-window") {
      const session = (
        await invoke([
          "tmux",
          "display-message",
          "-p",
          "-t",
          pane,
          "#{session_id}",
        ])
      ).trim();
      if (!/^\$\d+$/.test(session))
        throw new Error("Cannot resolve the calling tmux session.");

      await invoke([
        "tmux",
        "new-window",
        "-t",
        `${session}:`,
        "-c",
        cwd,
        "-n",
        "Guided Review",
        ...viewer,
      ]);
    } else if (target === "tmux-pane") {
      await invoke([
        "tmux",
        "split-window",
        "-t",
        pane,
        preferences.pane.direction === "right" ? "-h" : "-v",
        "-l",
        `${preferences.pane.size}%`,
        "-c",
        cwd,
        ...viewer,
      ]);
    } else {
      const client = (
        await invoke([
          "tmux",
          "display-message",
          "-p",
          "-t",
          pane,
          "#{client_name}",
        ])
      ).trim();
      if (!client)
        throw new Error("tmux-popup requires an attached tmux client.");
      await invoke(
        [
          "tmux",
          "display-popup",
          "-t",
          client,
          "-d",
          cwd,
          "-w",
          `${preferences.popup.width}%`,
          "-h",
          `${preferences.popup.height}%`,
          "-E",
          command,
        ],
        true,
      );
    }
  } else {
    const source = env.HERDR_PANE_ID || env.HERDR_ACTIVE_PANE_ID;
    if (!source || !env.HERDR_WORKSPACE_ID)
      throw new Error(`${target} requires a calling Herdr pane and workspace.`);
    const argv =
      target === "herdr-tab"
        ? [
            "herdr",
            "tab",
            "create",
            "--workspace",
            env.HERDR_WORKSPACE_ID,
            "--cwd",
            cwd,
            "--label",
            "Guided Review",
            "--focus",
          ]
        : [
            "herdr",
            "pane",
            "split",
            "--pane",
            source,
            "--direction",
            preferences.pane.direction,
            "--ratio",
            String(preferences.pane.size / 100),
            "--cwd",
            cwd,
            "--focus",
          ];
    const response = JSON.parse(await invoke(argv));
    const created =
      target === "herdr-tab"
        ? response.result?.root_pane?.pane_id
        : response.result?.pane?.pane_id;
    if (typeof created !== "string" || !created || created === source)
      throw new Error(
        "Herdr did not return a new pane ID; viewer was not started.",
      );

    await invoke(["herdr", "pane", "run", created, command]);
  }

  return `Launch request accepted: ${target}. Viewer initialization is not confirmed.`;
}
