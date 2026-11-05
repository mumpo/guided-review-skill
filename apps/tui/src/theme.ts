export type ThemeName = "github-light" | "github-dark";
export type ThemePreference = ThemeName | "auto";

/** Semantic colors shared by current presentation and upcoming rich renderers. */
export interface Theme {
  name: ThemeName;
  background: string;
  surface: string;
  text: string;
  muted: string;
  navigation: { foreground: string; background: string };
  scrollbar: { foreground: string; background: string };
  diff: {
    text: string;
    background: string;
    addition: { foreground: string; background: string };
    deletion: { foreground: string; background: string };
    context: string;
    hunk: string;
    file: string;
    lineNumber: string;
    marker: string;
  };
  diagram: { foreground: string; background: string; accent: string };
  markdown: {
    text: string;
    heading: string;
    link: string;
    code: string;
    codeBackground: string;
  };
}

export const themes: Record<ThemeName, Theme> = {
  "github-light": {
    name: "github-light",
    background: "#ffffff",
    surface: "#f6f8fa",
    text: "#1f2328",
    muted: "#59636e",
    navigation: { foreground: "#0969da", background: "#f6f8fa" },
    scrollbar: { foreground: "#59636e", background: "#f6f8fa" },
    diff: {
      text: "#1f2328",
      background: "#ffffff",
      addition: { foreground: "#116329", background: "#dafbe1" },
      deletion: { foreground: "#82071e", background: "#ffebe9" },
      context: "#1f2328",
      hunk: "#0550ae",
      file: "#1f2328",
      lineNumber: "#59636e",
      marker: "#59636e",
    },
    diagram: {
      foreground: "#1f2328",
      background: "#f6f8fa",
      accent: "#0969da",
    },
    markdown: {
      text: "#1f2328",
      heading: "#1f2328",
      link: "#0969da",
      code: "#1f2328",
      codeBackground: "#f6f8fa",
    },
  },
  "github-dark": {
    name: "github-dark",
    background: "#0d1117",
    surface: "#161b22",
    text: "#e6edf3",
    muted: "#9198a1",
    navigation: { foreground: "#79c0ff", background: "#161b22" },
    scrollbar: { foreground: "#9198a1", background: "#161b22" },
    diff: {
      text: "#e6edf3",
      background: "#0d1117",
      addition: { foreground: "#aff5b4", background: "#033a16" },
      deletion: { foreground: "#ffdcd7", background: "#67060c" },
      context: "#e6edf3",
      hunk: "#79c0ff",
      file: "#e6edf3",
      lineNumber: "#9198a1",
      marker: "#9198a1",
    },
    diagram: {
      foreground: "#e6edf3",
      background: "#161b22",
      accent: "#79c0ff",
    },
    markdown: {
      text: "#e6edf3",
      heading: "#e6edf3",
      link: "#79c0ff",
      code: "#e6edf3",
      codeBackground: "#161b22",
    },
  },
};

export function themeForMode(mode: "light" | "dark" | null): Theme {
  return themes[mode === "light" ? "github-light" : "github-dark"];
}
