import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadPreferences } from ".";

const temp = await mkdtemp(join(tmpdir(), "review-preferences-"));
afterAll(() => rm(temp, { recursive: true, force: true }));

test("TOML settings are shared, typed, and independently defaulted", async () => {
  const path = join(temp, "all.toml");
  await writeFile(
    path,
    `viewer = "tui"
auto_open = false
[tui]
theme = "auto"
light_theme = "github-dark"
dark_theme = "github-light"
diff_mode = "inline"
launch = "custom"
[tui.pane]
direction = "down"
size = 40
[tui.popup]
width = 80
height = 70
[tui.custom]
command = ["kitty", "--", "{viewer}"]
`,
  );

  const preferences = await loadPreferences({ config: path }, {});

  expect(preferences).toMatchObject({
    viewer: "tui",
    autoOpen: false,
    theme: "auto",
    lightTheme: "github-dark",
    darkTheme: "github-light",
    diffMode: "inline",
    launch: "custom",
    pane: { direction: "down", size: 40 },
    popup: { width: 80, height: 70 },
    custom: ["kitty", "--", "{viewer}"],
  });
});

test("CLI config overrides environment; explicit missing paths are errors", async () => {
  const path = join(temp, "override.toml");
  await writeFile(path, '[tui]\ndiff_mode = "inline"');

  expect(
    (
      await loadPreferences(
        { config: path },
        { GUIDED_REVIEW_CONFIG: "/missing" },
      )
    ).diffMode,
  ).toBe("inline");
  expect(configPath({ GUIDED_REVIEW_CONFIG: path })).toBe(path);
  await expect(loadPreferences({ config: "/missing" }, {})).rejects.toThrow(
    "Cannot read viewer configuration",
  );
  await expect(
    loadPreferences({}, { GUIDED_REVIEW_CONFIG: "/missing" }),
  ).rejects.toThrow("Cannot read viewer configuration");
});

test("legacy JSON requires manual migration and TOML takes precedence", async () => {
  const dir = await mkdtemp(join(temp, "legacy-"));
  const path = join(dir, "config.toml");
  await writeFile(join(dir, "config.json"), '{"theme":"github-light"}');

  await expect(loadPreferences({}, {}, path)).rejects.toThrow("Migrate");
  await writeFile(path, "");
  expect((await loadPreferences({}, {}, path)).theme).toBe("auto");
  expect(await Bun.file(join(dir, "config.json")).text()).toBe(
    '{"theme":"github-light"}',
  );
});

test("unsupported viewer, nested unknown keys, dimensions and custom commands fail before launching", async () => {
  const path = join(temp, "invalid.toml");
  for (const content of [
    'viewer = "web"',
    'auto_open = "yes"',
    '[tui]\nlight_theme = "blue"',
    '[tui]\nlaunch = "other"',
    "[tui.pane]\nsize = 100",
    "[tui.popup]\nheight = 0",
    '[tui.pane]\ndirection = "left"',
    "[tui.popup]\nextra = true",
    '[tui]\nlaunch = "custom"',
    '[tui.custom]\ncommand = ["kitty", "prefix{viewer}"]',
    '[tui.custom]\ncommand = ["{viewer}", "kitty"]',
    '[tui.custom]\ncommand = ["kitty", "{viewer}", "{viewer}"]',
  ]) {
    await writeFile(path, content);

    await expect(
      loadPreferences({ theme: "github-dark" }, {}, path),
    ).rejects.toThrow(`Invalid viewer configuration ${path}`);
  }
});

test("keybinding TOML preserves assignment order and reports invalid actions with the config path", async () => {
  const path = join(temp, "keybindings.toml");
  await writeFile(
    path,
    '[tui.keybindings]\ncursor_down = ["x", "j"]\ntoggle_file = ["x"]\n',
  );
  const preferences = await loadPreferences({ config: path }, {});

  expect(preferences.keybindings.cursor_down).toEqual(["j"]);
  expect(preferences.keybindings.toggle_file).toEqual(["x"]);
  expect(preferences.keybindings.next_section).toEqual(["ctrl+n"]);

  await writeFile(
    path,
    '[tui.keybindings]\ntoggle_file = ["x"]\ncursor_down = ["x", "j"]\n',
  );
  expect(
    (await loadPreferences({ config: path }, {})).keybindings.toggle_file,
  ).toEqual([]);

  await writeFile(path, '[tui.keybindings]\nunknown_action = ["x"]\n');
  await expect(loadPreferences({ config: path }, {})).rejects.toThrow(path);
  await expect(loadPreferences({ config: path }, {})).rejects.toThrow(
    "unknown_action",
  );

  await writeFile(path, '[tui.keybindings]\nnext_item = ["bad"]\n');
  await expect(loadPreferences({ config: path }, {})).rejects.toThrow(
    "tui.keybindings.next_item",
  );
});

test("comment expansion defaults to folded and accepts only a boolean", async () => {
  const path = join(temp, "comments.toml");
  await writeFile(path, "");
  expect((await loadPreferences({ config: path }, {})).commentsUnfolded).toBe(
    false,
  );

  await writeFile(path, "[tui]\ncomments_unfolded = true\n");
  expect((await loadPreferences({ config: path }, {})).commentsUnfolded).toBe(
    true,
  );

  await writeFile(path, '[tui]\ncomments_unfolded = "true"\n');
  await expect(loadPreferences({ config: path }, {})).rejects.toThrow(
    "comments_unfolded: expected a boolean",
  );
});
