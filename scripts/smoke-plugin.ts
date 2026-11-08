import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkLinks, run } from "./package-plugin";

/** Exercise the actual release archive, without access to checkout dependencies. */
export async function smokePlugin(input: string) {
  const temporary = await mkdtemp(join(tmpdir(), "guided-review-install-"));
  const plugin = join(temporary, "installed plugin");
  const project = join(temporary, "unrelated project");
  await mkdir(plugin);
  await mkdir(project);

  try {
    if ((await stat(input)).isDirectory())
      await cp(input, plugin, { recursive: true });
    else await run(["unzip", "-q", input, "-d", plugin], temporary);
    await checkLinks(plugin);

    const fixture = join(plugin, "skills/guided-review/fixtures/cli-pr-1.json");
    const snapshot = await Bun.file(fixture).json();
    await writeFile(
      join(project, "collection.json"),
      JSON.stringify({
        pullRequest: snapshot.pullRequest,
        files: snapshot.files,
      }),
    );
    await writeFile(
      join(project, "narrative.json"),
      JSON.stringify({
        summary: snapshot.summary,
        sections: snapshot.sections,
      }),
    );
    await writeFile(join(project, "config.toml"), "auto_open = false\n");

    const env = {
      // Only Bun on PATH: no gh, node, mmdc, package manager, or network tools.
      PATH: dirname(process.execPath),
      HOME: temporary,
      XDG_CONFIG_HOME: temporary,
      BUN_INSTALL_CACHE_DIR: join(temporary, "empty-cache"),
      BUN_BE_BUN: "1",
    };
    async function command(args: string[], code = 0) {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: project,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [actual, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      assert.equal(actual, code, `${args.join(" ")}\n${stdout}\n${stderr}`);
      return { stdout, stderr };
    }

    const scripts = join(plugin, "skills/guided-review/scripts");
    await command(["run", join(scripts, "collect.ts"), "--help"]);
    const invalid = await command(
      ["run", join(scripts, "collect.ts"), "https://example.com/pull/1"],
      1,
    );
    assert.match(invalid.stderr, /Expected a GitHub.com pull request URL/);
    await command([
      "run",
      join(scripts, "artifact.ts"),
      "build",
      "collection.json",
      "narrative.json",
      "review.json",
      "--report",
    ]);
    await command([
      "run",
      join(scripts, "artifact.ts"),
      "validate",
      "collection.json",
      "review.json",
    ]);
    const artifact = await Bun.file(join(project, "review.json")).text();
    assert.deepEqual(JSON.parse(artifact), snapshot);
    const disabled = await command([
      "run",
      join(scripts, "open.ts"),
      "--config",
      "config.toml",
      "--from-skill",
      "--",
      "review.json",
    ]);
    assert.match(disabled.stdout, /Automatic opening disabled/);

    // The probe's only nonstandard imports resolve inside the extracted plugin.
    const probe = `
import { strict as assert } from "node:assert";
const root = ${JSON.stringify(plugin)};
const { createTestRenderer } = await import(Bun.resolveSync("@opentui/core/testing", root + "/apps/tui"));
const { loadReview } = await import(root + "/apps/tui/src/load.ts");
const { mountReview } = await import(root + "/apps/tui/src/view.ts");
const { themes } = await import(root + "/apps/tui/src/theme.ts");
const { HighlightService, sessionHighlights } = await import(root + "/apps/tui/src/highlight-service.ts");
const review = await loadReview("review.json");
const source = "const answer: number = 42;";
const syntax = new HighlightService();
try {
  const colors = await syntax.highlight(source, "typescript");
  assert.ok(colors, "packaged syntax worker and dynamic grammar must work");
  for (const theme of Object.keys(themes)) {
    assert.equal(colors[theme][0].map(token => token.text).join(""), source);
    assert.ok(colors[theme][0].some(token => token.color));
  }
} finally { syntax.dispose(); }
for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"]) {
    const ui = await createTestRenderer({ width: 110, height: 35 });
    try {
      mountReview(ui.renderer, review, theme, mode);
      await sessionHighlights(ui.renderer).settled();
      await ui.renderOnce();
      assert.ok(ui.captureCharFrame().includes(review.snapshot.pullRequest.title));
      await ui.mockInput.pressKeys(["n"]);
      await sessionHighlights(ui.renderer).settled();
      await ui.renderOnce();
      assert.ok(ui.captureCharFrame().includes(review.snapshot.sections[0].title));
      await ui.mockInput.pressKeys(["j", "d"]);
      ui.resize(65, 25);
      await ui.renderOnce();
      assert.ok(ui.captureCharFrame().length > 0);
    } finally {
      await sessionHighlights(ui.renderer).settled();
      await ui.dispose();
    }
  }
}
console.log("Packaged native renderer, both themes/layouts, navigation, resize, and syntax worker passed");
`;
    await writeFile(join(project, "probe.ts"), probe);
    const result = await command(["run", "probe.ts"]);
    console.log(result.stdout.trim());
    assert.equal(await Bun.file(join(project, "review.json")).text(), artifact);
    console.log(
      "Extracted plugin helpers and offline artifact round-trip passed",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        "Usage: bun run test:plugin <plugin.zip|installed-directory>",
      );

    await smokePlugin(resolve(process.argv[2]));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
