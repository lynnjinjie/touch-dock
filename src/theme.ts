export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "touchdock.theme";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // System remains a safe default when storage is unavailable.
  }
  return "system";
}

export function applyTheme(preference: ThemePreference) {
  const resolved = preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The active theme still works for the current session.
  }
}

export function watchSystemTheme(callback: () => void) {
  systemTheme.addEventListener("change", callback);
  return () => systemTheme.removeEventListener("change", callback);
}
