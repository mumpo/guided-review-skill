import { loadReview } from "./load";

export const usage = "Usage: bun run dev:tui <path/to/review.json>";

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    return;
  }
  if (args.length !== 1) throw new Error(usage);

  // Validate before loading native UI code or taking control of the terminal.
  const review = await loadReview(args[0]);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The viewer needs an interactive terminal (TTY).");
  }
  const { createCliRenderer } = await import("@opentui/core");
  const { mountReview } = await import("./view");
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    useMouse: false,
  });
  try {
    mountReview(renderer, review);
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
