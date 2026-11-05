import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadThemePreference, parseArgs } from "./config";

const temp = await mkdtemp(join(tmpdir(), "guided-review-theme-"));
afterAll(() => rm(temp, { recursive: true, force: true }));

test("CLI supports both theme forms, option order, help, and escaped paths", () => {
  expect(parseArgs(["--theme", "github-light", "review.json"])).toEqual({
    help: false,
    path: "review.json",
    theme: "github-light",
  });
  expect(parseArgs(["review.json", "--theme=github-dark"])).toMatchObject({
    theme: "github-dark",
  });
  expect(parseArgs(["--", "-review.json"])).toMatchObject({
    path: "-review.json",
  });
  expect(parseArgs(["--help"])).toEqual({ help: true });
  for (const args of [
    [],
    ["a", "b"],
    ["--unknown", "a"],
    ["a", "--theme"],
    ["a", "--theme=blue"],
    ["a", "--theme=auto", "--theme=auto"],
  ]) {
    expect(() => parseArgs(args)).toThrow();
  }
});

test("user configuration uses XDG or the home fallback", () => {
  expect(configPath({}, "/home/test")).toBe(
    "/home/test/.config/guided-review/config.json",
  );
  expect(configPath({ XDG_CONFIG_HOME: "/custom" }, "/home/test")).toBe(
    "/custom/guided-review/config.json",
  );
  expect(configPath({ XDG_CONFIG_HOME: "" }, "/home/test")).toBe(
    "/home/test/.config/guided-review/config.json",
  );
});

test("theme precedence is CLI, environment, config, then auto", async () => {
  const missing = join(temp, "missing.json");
  expect(await loadThemePreference(undefined, {}, missing)).toBe("auto");
  const path = join(temp, "valid.json");
  await writeFile(path, '{"theme":"github-light"}');
  expect(await loadThemePreference(undefined, {}, path)).toBe("github-light");
  const env = { GUIDED_REVIEW_THEME: "github-dark" };
  expect(await loadThemePreference(undefined, env, path)).toBe("github-dark");
  expect(await loadThemePreference("auto", env, path)).toBe("auto");
  await writeFile(path, "{}");
  expect(await loadThemePreference(undefined, {}, path)).toBe("auto");
});

test("invalid configuration is actionable even when a higher priority source overrides it", async () => {
  const path = join(temp, "invalid.json");
  for (const content of [
    "{",
    "null",
    "[]",
    '{"theme":"blue"}',
    '{"theme":null}',
    '{"them":"auto"}',
  ]) {
    await writeFile(path, content);
    await expect(loadThemePreference("github-dark", {}, path)).rejects.toThrow(
      `Invalid theme configuration ${path}`,
    );
  }
  await expect(loadThemePreference(undefined, {}, temp)).rejects.toThrow(
    "Cannot read theme configuration",
  );
  for (const value of ["", "light"]) {
    await expect(
      loadThemePreference(
        "github-dark",
        { GUIDED_REVIEW_THEME: value },
        join(temp, "missing.json"),
      ),
    ).rejects.toThrow(
      "GUIDED_REVIEW_THEME: expected auto, github-light, or github-dark",
    );
  }
});
