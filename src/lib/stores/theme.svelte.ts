import { browser } from "$app/environment";

export const themeState = $state({
  current: "nord",
});

export function initTheme() {
  if (browser) {
    const stored = localStorage.getItem("theme");
    if (stored) {
      themeState.current = stored;
    } else {
      themeState.current = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dim"
        : "nord";
    }
    document.documentElement.setAttribute("data-theme", themeState.current);
  }
}

export function toggleTheme() {
  themeState.current = themeState.current === "nord" ? "dim" : "nord";
  if (browser) {
    localStorage.setItem("theme", themeState.current);
    document.documentElement.setAttribute("data-theme", themeState.current);
  }
}
