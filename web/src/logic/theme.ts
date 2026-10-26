// Light unless the family picked dark; the choice lives in this browser only.
// Base.astro applies the saved choice before first paint, so this module only flips it.
export type Theme = "light" | "dark";

const KEY = "nido-theme";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows can refuse storage; the theme still applies for this visit.
  }
}
