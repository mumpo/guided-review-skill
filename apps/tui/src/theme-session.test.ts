import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { startTheme } from "./theme-session";
import type { Theme } from "./theme";

function terminal(
  mode: "light" | "dark" | null = null,
  reply: "light" | "dark" | null = null,
) {
  const emitter = Object.assign(new EventEmitter(), {
    themeMode: mode,
    isDestroyed: false,
    waitForThemeMode: mock(async (_timeout: number) => reply),
  });

  return {
    emitter,
    renderer: emitter as unknown as Parameters<typeof startTheme>[0],
  };
}

test("auto selects cached or queried light/dark mode and bounds detection to 300ms", async () => {
  for (const mode of ["light", "dark"] as const) {
    for (const cached of [true, false]) {
      const { emitter, renderer } = terminal(cached ? mode : null, mode);
      const apply = mock((_theme: Theme) => {});

      await startTheme(renderer, "auto", apply);

      expect(apply.mock.calls[0][0].name).toBe(`github-${mode}`);

      if (cached) expect(emitter.waitForThemeMode).not.toHaveBeenCalled();
      else expect(emitter.waitForThemeMode).toHaveBeenCalledWith(300);
    }
  }
});

test("auto falls back to dark, accepts late detection and live changes, and cleans up", async () => {
  const { emitter, renderer } = terminal();
  const applied: string[] = [];

  await startTheme(renderer, "auto", (theme) => applied.push(theme.name));
  emitter.emit("theme_mode", "light");
  emitter.emit("theme_mode", "dark");

  expect(applied).toEqual(["github-dark", "github-light", "github-dark"]);

  emitter.isDestroyed = true;
  emitter.emit("destroy");

  expect(emitter.listenerCount("theme_mode")).toBe(0);

  emitter.emit("theme_mode", "light");

  expect(applied).toHaveLength(3);
});

test("explicit themes bypass detection and remain fixed", async () => {
  for (const preference of ["github-light", "github-dark"] as const) {
    const { emitter, renderer } = terminal("light");
    const apply = mock((_theme: Theme) => {});

    await startTheme(renderer, preference, apply);
    emitter.emit("theme_mode", "dark");

    expect(emitter.waitForThemeMode).not.toHaveBeenCalled();
    expect(emitter.listenerCount("theme_mode")).toBe(0);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].name).toBe(preference);
  }
});

test("a live reply during initial detection wins; quitting during detection never mounts UI", async () => {
  for (const close of [false, true]) {
    const { emitter, renderer } = terminal();
    let finish!: (mode: "dark" | null) => void;

    emitter.waitForThemeMode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const apply = mock((_theme: Theme) => {});
    const pending = startTheme(renderer, "auto", apply);

    emitter.emit("theme_mode", "light");
    if (close) {
      emitter.isDestroyed = true;
      emitter.emit("destroy");
    }

    finish("dark");
    await pending;
    if (close) expect(apply).not.toHaveBeenCalled();
    else expect(apply.mock.calls[0][0].name).toBe("github-light");
  }
});

test("configured bundled light/dark themes follow initial and live appearance", async () => {
  const { emitter, renderer } = terminal("light");
  const applied: string[] = [];

  await startTheme(renderer, "auto", (theme) => applied.push(theme.name), {
    lightTheme: "github-dark",
    darkTheme: "github-light",
  });
  emitter.emit("theme_mode", "dark");

  expect(applied).toEqual(["github-dark", "github-light"]);
});
