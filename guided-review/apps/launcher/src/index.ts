import { resolve } from "node:path";
import { loadPreferences } from "../../../packages/preferences/src";
import { loadReview } from "../../tui/src/load";
import { parseArgs } from "../../tui/src/config";
import { launch, shellQuote } from "./launch";

export const usage =
  "Usage: bun run open:review [--config PATH] [--from-skill] <artifact.json>";

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }

  const separator = args.indexOf("--");
  const flags = separator < 0 ? args : args.slice(0, separator);
  const fromSkill = flags.includes("--from-skill");
  if (flags.filter((arg) => arg === "--from-skill").length > 1)
    throw new Error("Duplicate --from-skill");
  const options = parseArgs(
    args.filter(
      (arg, index) =>
        !(arg === "--from-skill" && (separator < 0 || index < separator)),
    ),
  );
  if (options.help) return;

  const artifact = resolve(options.path);
  try {
    const preferences = await loadPreferences(options);
    if (fromSkill && !preferences.autoOpen) {
      console.log(`Automatic opening disabled. Artifact: ${artifact}`);
      return;
    }

    await loadReview(artifact);
    console.log(await launch(preferences, artifact));
  } catch (error) {
    const viewer = resolve(import.meta.dir, "../../tui/src/index.ts");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nArtifact retained: ${artifact}\nOpen manually: ${[process.execPath, viewer, ...(options.config ? ["--config", resolve(options.config)] : []), "--", artifact].map(shellQuote).join(" ")}`,
    );
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Launch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
