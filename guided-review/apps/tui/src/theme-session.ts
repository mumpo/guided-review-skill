import type { CliRenderer } from "@opentui/core";
import {
  type Theme,
  type ThemePreference,
  type ThemeName,
  themes,
} from "./theme";

/** Subscribe before waiting so late replies and live changes cannot be lost. */
export async function startTheme(
  renderer: Pick<
    CliRenderer,
    "themeMode" | "waitForThemeMode" | "on" | "off" | "once" | "isDestroyed"
  >,
  preference: ThemePreference,
  apply: (theme: Theme) => void,
  automatic: { lightTheme: ThemeName; darkTheme: ThemeName } = {
    lightTheme: "github-light",
    darkTheme: "github-dark",
  },
): Promise<void> {
  if (preference !== "auto") {
    if (!renderer.isDestroyed) apply(themes[preference]);

    return;
  }

  const forMode = (mode: "light" | "dark" | null) =>
    themes[mode === "light" ? automatic.lightTheme : automatic.darkTheme];

  let ready = false;
  let latest = renderer.themeMode;
  const onMode = (mode: "light" | "dark") => {
    latest = mode;
    if (ready && !renderer.isDestroyed) apply(forMode(mode));
  };

  renderer.on("theme_mode", onMode);
  renderer.once("destroy", () => renderer.off("theme_mode", onMode));

  const detected = latest ?? (await renderer.waitForThemeMode(300));
  ready = true;
  if (!renderer.isDestroyed) apply(forMode(latest ?? detected));
}
