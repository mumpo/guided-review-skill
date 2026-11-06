import { loadReview } from "./load";
import { loadPreferences, parseArgs, usage } from "./config";

export { usage } from "./config";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage);
    return;
  }

  const preferences = await loadPreferences(options);

  // Validate before loading native UI code or taking control of the terminal.
  const review = await loadReview(options.path);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The viewer needs an interactive terminal (TTY).");
  }

  const { createCliRenderer } = await import("@opentui/core");
  const { mountReview } = await import("./view");
  const { startTheme } = await import("./theme-session");
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    useMouse: true,
  });

  try {
    let applyTheme: ReturnType<typeof mountReview> | undefined;

    await startTheme(
      renderer,
      preferences.theme,
      (theme) => {
        if (applyTheme) applyTheme(theme);
        else
          applyTheme = mountReview(
            renderer,
            review,
            theme,
            preferences.diffMode,
          );
      },
      preferences,
    );
    await renderer.closed;
  } finally {
    renderer.destroy();
    await renderer.closed;
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Review failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
