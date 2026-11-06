import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export async function permissionRules(skillDirectory: string): Promise<string> {
  const directory = await realpath(skillDirectory);
  const rules = ["collect", "open"].map((helper) => {
    const pattern = ["bun", "run", join(directory, "scripts", `${helper}.ts`)];

    return `prefix_rule(\n    pattern = ${JSON.stringify(pattern)},\n    decision = "allow",\n    justification = ${JSON.stringify(helper === "collect" ? "Capture a GitHub PR using the trusted Guided Review collector" : "Open a local review using trusted Guided Review viewer preferences")},\n)\n`;
  });

  return `# Guided Review: trust these two installed helpers and their dependencies.\n# The launcher also trusts custom executables selected in your config.toml.\n# No blanket Bun, gh, Herdr, shell, or setup-command permission is granted.\n\n${rules.join("\n")}`;
}

export async function setupPermissions(
  args: string[],
  options: { skillDirectory?: string; codexHome?: string } = {},
): Promise<string> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    return "Usage: bun run skills/guided-review/scripts/setup-permissions.ts [--install]\nWithout --install, preview the Codex rules without writing files.";
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--install"))
    throw new Error("Expected no arguments (preview) or --install.");

  const content = await permissionRules(
    options.skillDirectory ?? resolve(import.meta.dir, ".."),
  );
  const path = join(
    options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    "rules",
    "guided-review.rules",
  );
  if (args.length === 0)
    return `Would install: ${path}\n\n${content}\nRun again with --install after reviewing these permissions. Restart Codex afterward.`;

  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing !== undefined && existing !== content)
    throw new Error(
      `${path} already contains different rules. Review or remove that file before installing; existing rules were not changed.`,
    );
  if (existing === content)
    return `Already installed: ${path}\nRestart Codex to load these rules.`;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { flag: "wx", mode: 0o600 });

  return `Installed: ${path}\nRestart Codex to load these rules. Managed restrictions still apply.`;
}

if (import.meta.main) {
  try {
    console.log(await setupPermissions(process.argv.slice(2)));
  } catch (error) {
    console.error(
      `Permission setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
