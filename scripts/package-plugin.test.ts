import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLinks, packagePlugin, repositoryRoot } from "./package-plugin";

const temporary = await mkdtemp(join(tmpdir(), "plugin-package-test-"));

afterAll(() => rm(temporary, { recursive: true, force: true }));

test("packaging rejects output inside copied source trees before writing", async () => {
  await expect(
    packagePlugin(join(repositoryRoot, "apps", "plugin-output")),
  ).rejects.toThrow("outside the runtime source trees");
});

test("packaging refuses existing output without replacing user files", async () => {
  const output = join(temporary, "existing");
  await mkdir(output);
  await writeFile(join(output, "keep.txt"), "keep this");

  await expect(packagePlugin(output)).rejects.toThrow("EEXIST");

  expect(await Bun.file(join(output, "keep.txt")).text()).toBe("keep this");
});

test("packages allow internal links and reject external or dangling dependencies", async () => {
  const root = join(temporary, "links");
  await mkdir(root);
  await writeFile(join(root, "dependency"), "bundled");
  await symlink("dependency", join(root, "internal"));

  await checkLinks(root);
  await symlink("../existing/keep.txt", join(root, "external"));

  await expect(checkLinks(root)).rejects.toThrow("escapes package");

  await rm(join(root, "external"));
  await symlink("missing", join(root, "dangling"));

  await expect(checkLinks(root)).rejects.toThrow("ENOENT");
});

test("both host catalogs target the built runtime, with matching plugin identities", async () => {
  const read = (path: string) => Bun.file(join(repositoryRoot, path)).json();
  const portable = await read("plugin.json");
  const claude = await read(".claude-plugin/plugin.json");

  expect(claude.name).toBe(portable.name);
  expect(claude.version).toBe(portable.version);
  expect(portable.extensions["com.openai"].requires_local_executor).toBe(true);

  for (const path of [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
  ]) {
    const catalog = await read(path);

    expect(catalog.name).toBe("mumpo-plugins");
    expect(catalog.plugins[0].name).toBe(portable.name);
    expect(catalog.plugins[0].source).toMatchObject({
      source: "git-subdir",
      ref: "plugins",
      url: "https://github.com/mumpo/guided-review-skill.git",
    });
    expect(catalog.plugins[0].source.path.replace(/^\.\//, "")).toBe(
      "guided-review",
    );
  }
});
