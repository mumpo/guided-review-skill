import { afterAll, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { permissionRules, setupPermissions } from "./setup-permissions";

const temp = await mkdtemp(join(tmpdir(), "review-permissions-"));
afterAll(() => rm(temp, { recursive: true, force: true }));
const skillDirectory = resolve(import.meta.dir, "..");

test("preview is read-only and install is idempotent without changing unrelated rules", async () => {
  const codexHome = join(temp, "codex");
  const rule = join(codexHome, "rules", "guided-review.rules");
  const options = { skillDirectory, codexHome };

  const preview = await setupPermissions([], options);

  expect(preview).toContain("Would install:");
  expect(await Bun.file(rule).exists()).toBe(false);
  await mkdir(join(codexHome, "rules"), { recursive: true });
  await writeFile(join(codexHome, "rules", "default.rules"), "existing rules");

  expect(await setupPermissions(["--install"], options)).toContain(
    "Installed:",
  );
  const installed = await readFile(rule, "utf8");
  expect(await setupPermissions(["--install"], options)).toContain(
    "Already installed:",
  );
  expect(await readFile(rule, "utf8")).toBe(installed);
  expect(
    await readFile(join(codexHome, "rules", "default.rules"), "utf8"),
  ).toBe("existing rules");

  await writeFile(rule, "user's different rules");

  await expect(setupPermissions(["--install"], options)).rejects.toThrow(
    "different rules",
  );
  expect(await readFile(rule, "utf8")).toBe("user's different rules");
});

test("rules resolve discovery symlinks and contain only the two exact helpers", async () => {
  const link = join(temp, "skill-link");
  await symlink(skillDirectory, link);

  const content = await permissionRules(link);
  const patterns = [...content.matchAll(/pattern = (\[[^\n]+\]),/g)].map(
    (match) => JSON.parse(match[1]),
  );

  expect(patterns).toEqual(
    ["collect", "open"].map((helper) => [
      "bun",
      "run",
      join(skillDirectory, "scripts", `${helper}.ts`),
    ]),
  );
  expect(content).not.toContain(link);
  expect(
    await setupPermissions(["--help"], { skillDirectory: "/missing" }),
  ).toContain("preview");
  await expect(setupPermissions(["--unknown"])).rejects.toThrow(
    "Expected no arguments",
  );
});

test("generated rule syntax quotes installation paths with spaces and metacharacters", async () => {
  const directory = join(temp, "skill ' with spaces");
  await mkdir(directory);

  const content = await permissionRules(directory);
  const patterns = [...content.matchAll(/pattern = (\[[^\n]+\]),/g)].map(
    (match) => JSON.parse(match[1]),
  );

  expect(patterns[0]).toEqual([
    "bun",
    "run",
    join(await realpath(directory), "scripts", "collect.ts"),
  ]);
});

test("collector and viewer helpers work through both discovery links from another directory", async () => {
  for (const discovery of [".agents", ".claude"]) {
    const base = resolve(
      import.meta.dir,
      "../../..",
      discovery,
      "skills/guided-review/scripts",
    );
    for (const helper of ["collect", "open"]) {
      const child = Bun.spawn(
        [process.execPath, "run", join(base, `${helper}.ts`), "--help"],
        { cwd: temp, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(stdout).toContain(
        helper === "collect" ? "--output" : "--from-skill",
      );
    }
  }
});
