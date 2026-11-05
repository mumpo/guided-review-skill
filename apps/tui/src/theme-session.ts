import type { CliRenderer } from "@opentui/core";
import {
  type Theme,
  type ThemePreference,
  themeForMode,
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
): Promise<void> {
  if (preference !== "auto") {
    if (!renderer.isDestroyed) apply(themes[preference]);

    return;
  }

  let ready = false;
  let latest = renderer.themeMode;
  const onMode = (mode: "light" | "dark") => {
    latest = mode;
    if (ready && !renderer.isDestroyed) apply(themeForMode(mode));
  };

  renderer.on("theme_mode", onMode);
  renderer.once("destroy", () => renderer.off("theme_mode", onMode));

  const detected = latest ?? (await renderer.waitForThemeMode(300));
  ready = true;
  if (!renderer.isDestroyed) apply(themeForMode(latest ?? detected));
}
