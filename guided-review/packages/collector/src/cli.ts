import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectPullRequest } from "./index";

export const usage =
  "Usage: bun run collect [--output PATH] <https://github.com/OWNER/REPO/pull/NUMBER>";

export function parseArgs(
  args: string[],
): { help: true } | { help: false; url: string; output?: string } {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]))
    return { help: true };

  let url: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg.startsWith("--output=")) {
      if (output !== undefined) throw new Error(`Duplicate --output. ${usage}`);
      output = arg === "--output" ? args[++i] : arg.slice(9);
      if (!output || output.startsWith("--"))
        throw new Error(`Missing --output path. ${usage}`);
    } else if (arg.startsWith("-") || url !== undefined) throw new Error(usage);
    else url = arg;
  }
  if (!url) throw new Error(usage);

  return {
    help: false,
    url,
    ...(output === undefined ? {} : { output: resolve(output) }),
  };
}

export async function main(
  args = process.argv.slice(2),
  collect = collectPullRequest,
): Promise<string> {
  const options = parseArgs(args);
  if (options.help) return usage;

  const json = JSON.stringify(await collect(options.url), null, 2);
  if (!options.output) return json;

  try {
    await writeFile(options.output, `${json}\n`, { flag: "wx" });
  } catch (error) {
    throw new Error(
      `Cannot write collection ${options.output}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return `Collected snapshot: ${options.output}`;
}

if (import.meta.main) {
  try {
    console.log(await main());
  } catch (error) {
    console.error(
      `Collection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
