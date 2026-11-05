export type ThemeName = "github-light" | "github-dark";

export type ThemePreference = ThemeName | "auto";

/** Semantic colors shared by narrative, diagrams, and diffs. */
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
    addition: {
      foreground: string;
      background: string;
      gutterBackground: string;
      spanBackground: string;
    };
    deletion: {
      foreground: string;
      background: string;
      gutterBackground: string;
      spanBackground: string;
    };
    context: string;
    hunk: string;
    file: string;
    statsAddition: string;
    statsDeletion: string;
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
      addition: {
        foreground: "#116329",
        background: "#dafbe1",
        gutterBackground: "#aceebb",
        spanBackground: "#aceebb",
      },
      deletion: {
        foreground: "#82071e",
        background: "#ffebe9",
        gutterBackground: "#ffcecb",
        spanBackground: "#ffcecb",
      },
      context: "#1f2328",
      hunk: "#0550ae",
      file: "#1f2328",
      statsAddition: "#3fb950",
      statsDeletion: "#f85149",
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
      addition: {
        foreground: "#aff5b4",
        background: "#033a16",
        gutterBackground: "#2ea04366",
        spanBackground: "#1a4a29",
      },
      deletion: {
        foreground: "#ffdcd7",
        background: "#67060c",
        gutterBackground: "#f8514966",
        spanBackground: "#6b2b2b",
      },
      context: "#e6edf3",
      hunk: "#79c0ff",
      file: "#e6edf3",
      statsAddition: "#3fb950",
      statsDeletion: "#f85149",
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

/** Flatten GitHub's translucent gutter colors over the diff canvas for the terminal. */
export function diffGutterBackground(
  theme: Theme,
  role: "addition" | "deletion",
): string {
  const color = theme.diff[role].gutterBackground;
  if (color.length !== 9) return color;

  const alpha = Number.parseInt(color.slice(7, 9), 16) / 255;
  const channels = [1, 3, 5].map((offset) => {
    const foreground = Number.parseInt(color.slice(offset, offset + 2), 16);
    const background = Number.parseInt(
      theme.diff.background.slice(offset, offset + 2),
      16,
    );

    return Math.round(foreground * alpha + background * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  });

  return `#${channels.join("")}`;
}
