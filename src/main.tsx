import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TrayPanel } from "./TrayPanel";
import { applyTheme, readThemePreference } from "./theme";

applyTheme(readThemePreference());
const isTrayPanel = new URLSearchParams(window.location.search).get("surface") === "tray";
if (isTrayPanel) document.documentElement.dataset.surface = "tray";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {isTrayPanel ? <TrayPanel /> : <App />}
  </StrictMode>,
);
