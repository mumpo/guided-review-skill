import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dir, "..");

export async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await child.exited) !== 0)
    throw new Error(`Command failed: ${command.join(" ")}`);
}

async function json(path: string) {
  return Bun.file(path).json();
}

/** A cached plugin must never resolve files from the source checkout or Bun cache. */
export async function checkLinks(root: string, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = relative(await realpath(root), await realpath(path));
      if (target === ".." || target.startsWith("../") || isAbsolute(target))
        throw new Error(`Plugin symlink escapes package: ${path}`);
    } else if (entry.isDirectory()) {
      await checkLinks(root, path);
    }
  }
}

export async function packagePlugin(output: string) {
  const destination = resolve(output);
  const sourceTree = relative(repositoryRoot, destination).split(/[\\/]/)[0];
  if (
    [
      "apps",
      "packages",
      "skills",
      "docs",
      ".agents",
      ".claude-plugin",
    ].includes(sourceTree)
  )
    throw new Error("Package output must be outside the runtime source trees");

  output = destination;
  const manifest = await json(join(repositoryRoot, "plugin.json"));
  const claude = await json(join(repositoryRoot, ".claude-plugin/plugin.json"));
  if (
    manifest.name !== claude.name ||
    manifest.version !== claude.version ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  )
    throw new Error(
      "Plugin manifests must have matching names and release versions",
    );

  // mkdir without recursive refuses existing output, including user-owned files.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);

  const marketplace = join(output, "marketplace");
  const plugin = join(marketplace, "guided-review");
  await mkdir(plugin, { recursive: true });

  // Retain source-relative paths for the launcher and both worker entrypoints.
  for (const path of [
    "apps",
    "packages",
    "skills/guided-review",
    "package.json",
    "bun.lock",
    "plugin.json",
    ".claude-plugin/plugin.json",
    "README.md",
    "PLAN.md",
    "docs/distribution.md",
    "LICENSE",
    "config.example.toml",
  ]) {
    await cp(join(repositoryRoot, path), join(plugin, path), {
      recursive: true,
      filter: (source) =>
        !["node_modules", "dist"].includes(source.split("/").at(-1) ?? "") &&
        !/\.(?:test|integration\.test)\.ts$/.test(source),
    });
  }

  // Publisher-only installation. Ship all architectures so users never install.
  await run(
    [
      process.execPath,
      "install",
      "--production",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--linker",
      "hoisted",
      "--os",
      "*",
      "--cpu",
      "*",
    ],
    plugin,
  );

  const native = await json(
    join(plugin, "node_modules/@opentui/core/package.json"),
  );
  for (const [name, version] of Object.entries(native.optionalDependencies)) {
    const installed = await json(
      join(plugin, "node_modules", name, "package.json"),
    );
    if (installed.version !== version)
      throw new Error(
        `Missing or mismatched native dependency: ${name}@${version}`,
      );
  }

  await checkLinks(plugin);

  for (const path of [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
  ]) {
    const catalog = await json(join(repositoryRoot, path));
    catalog.plugins[0].source = path.startsWith(".agents")
      ? { source: "local", path: "./guided-review" }
      : "./guided-review";
    await mkdir(dirname(join(marketplace, path)), { recursive: true });
    await writeFile(
      join(marketplace, path),
      `${JSON.stringify(catalog, null, 2)}\n`,
    );
  }

  const archive = join(output, `guided-review-${manifest.version}.zip`);
  await run(["zip", "-q", "-r", "-y", archive, "."], plugin);
  if (!(await lstat(archive)).size) throw new Error("Empty plugin archive");

  return { plugin, marketplace, archive, version: manifest.version as string };
}

if (import.meta.main) {
  try {
    if (process.argv.length > 3)
      throw new Error("Usage: bun run package:plugin [NEW_OUTPUT_DIRECTORY]");

    const result = await packagePlugin(
      resolve(process.argv[2] ?? "dist/plugin"),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
