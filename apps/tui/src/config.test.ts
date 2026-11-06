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
    "/home/test/.config/guided-review/config.toml",
  );
  expect(configPath({ XDG_CONFIG_HOME: "/custom" }, "/home/test")).toBe(
    "/custom/guided-review/config.toml",
  );
  expect(configPath({ XDG_CONFIG_HOME: "" }, "/home/test")).toBe(
    "/home/test/.config/guided-review/config.toml",
  );
});

test("theme precedence is CLI, environment, config, then auto", async () => {
  const missing = join(temp, "missing.toml");

  expect(await loadThemePreference(undefined, {}, missing)).toBe("auto");

  const path = join(temp, "valid.toml");

  await writeFile(path, '[tui]\ntheme = "github-light"');

  expect(await loadThemePreference(undefined, {}, path)).toBe("github-light");

  const env = { GUIDED_REVIEW_THEME: "github-dark" };

  expect(await loadThemePreference(undefined, env, path)).toBe("github-dark");
  expect(await loadThemePreference("auto", env, path)).toBe("auto");

  await writeFile(path, "");

  expect(await loadThemePreference(undefined, {}, path)).toBe("auto");
});

test("invalid configuration is actionable even when a higher priority source overrides it", async () => {
  const path = join(temp, "invalid.toml");

  for (const content of [
    "{",
    "null",
    "[]",
    '[tui]\ntheme = "blue"',
    "[tui]\ntheme = false",
    '[tui]\nthem = "auto"',
  ]) {
    await writeFile(path, content);

    await expect(loadThemePreference("github-dark", {}, path)).rejects.toThrow(
      `Invalid viewer configuration ${path}`,
    );
  }

  await expect(loadThemePreference(undefined, {}, temp)).rejects.toThrow(
    "Cannot read viewer configuration",
  );

  for (const value of ["", "light"]) {
    await expect(
      loadThemePreference(
        "github-dark",
        { GUIDED_REVIEW_THEME: value },
        join(temp, "missing.toml"),
      ),
    ).rejects.toThrow(
      "GUIDED_REVIEW_THEME: expected auto, github-light, github-dark",
    );
  }
});

test("diff mode accepts both CLI forms and rejects missing, invalid, and duplicate values", () => {
  expect(parseArgs(["--diff-mode", "inline", "review.json"])).toMatchObject({
    diffMode: "inline",
  });
  expect(
    parseArgs(["review.json", "--diff-mode=side-by-side", "--theme=auto"]),
  ).toMatchObject({ diffMode: "side-by-side", theme: "auto" });

  for (const args of [
    ["a", "--diff-mode"],
    ["a", "--diff-mode=split"],
    ["a", "--diff-mode=auto", "--diff-mode=inline"],
  ]) {
    expect(() => parseArgs(args)).toThrow("--diff-mode");
  }
});

test("shared configuration resolves diff mode independently and validates overridden values", async () => {
  const { loadPreferences } = await import("./config");
  const path = join(temp, "diff.toml");

  expect(
    await loadPreferences({}, {}, join(temp, "missing.toml")),
  ).toMatchObject({
    theme: "auto",
    diffMode: "auto",
  });

  await writeFile(
    path,
    '[tui]\ntheme = "github-light"\ndiff_mode = "side-by-side"',
  );

  expect(await loadPreferences({}, {}, path)).toMatchObject({
    theme: "github-light",
    diffMode: "side-by-side",
  });
  expect(
    await loadPreferences(
      { diffMode: "auto" },
      { GUIDED_REVIEW_THEME: "github-dark" },
      path,
    ),
  ).toMatchObject({ theme: "github-dark", diffMode: "auto" });

  for (const value of ["split", false, 1]) {
    await writeFile(path, `[tui]\ndiff_mode = ${JSON.stringify(value)}`);

    await expect(
      loadPreferences({ diffMode: "inline" }, {}, path),
    ).rejects.toThrow("tui.diff_mode: expected auto, inline, side-by-side");
  }
});
