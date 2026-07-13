import { Monitor, Moon, Palette, SlidersHorizontal, Sun, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ThemePreference } from "./theme";
import { createTranslator, type LanguagePreference } from "./i18n";

interface SettingsDialogProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => void;
  onClose: () => void;
}

const themes = [
  { value: "light", label: "light", Icon: Sun },
  { value: "dark", label: "dark", Icon: Moon },
  { value: "system", label: "system", Icon: Monitor },
] as const;

export function SettingsDialog({ theme, onThemeChange, language, onLanguageChange, onClose }: SettingsDialogProps) {
  const [section, setSection] = useState<"general" | "appearance">("general");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const languageRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = createTranslator(language);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") nextIndex = (index + themes.length - 1) % themes.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % themes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = themes.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    onThemeChange(themes[nextIndex].value);
    optionRefs.current[nextIndex]?.focus();
  }

  function handleLanguageKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "ArrowLeft" || event.key === "Home" ? 0 : 1;
    const nextLanguage = (["en", "zh-CN"] as const)[nextIndex];
    onLanguageChange(nextLanguage);
    languageRefs.current[nextIndex]?.focus();
  }

  return (
    <dialog
      className="settings-dialog"
      ref={dialogRef}
      aria-labelledby="settings-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="settings-panel">
        <aside className="settings-sidebar">
          <h2 id="settings-title">{t("settings")}</h2>
          <nav aria-label={t("settings")}>
            <button className={section === "general" ? "active" : ""} type="button" aria-current={section === "general" ? "page" : undefined} onClick={() => setSection("general")}><SlidersHorizontal aria-hidden="true" size={16} /><span>{t("general")}</span></button>
            <button className={section === "appearance" ? "active" : ""} type="button" aria-current={section === "appearance" ? "page" : undefined} onClick={() => setSection("appearance")}><Palette aria-hidden="true" size={16} /><span>{t("appearance")}</span></button>
          </nav>
        </aside>
        <main className="settings-main">
          <button className="icon-button settings-close" type="button" aria-label={t("closeSettings")} title={t("closeSettings")} onClick={onClose}><X aria-hidden="true" size={17} strokeWidth={1.8} /></button>
          {section === "general" ? (
            <section className="settings-content" aria-labelledby="general-title">
              <header className="settings-page-header"><h3 id="general-title">{t("general")}</h3></header>
              <div className="setting-row setting-row-horizontal">
                <span className="setting-copy"><strong>{t("language")}</strong><small>{t("languageDescription")}</small></span>
                <div className="theme-options language-options" role="radiogroup" aria-label={t("language")}>
                  {(["en", "zh-CN"] as const).map((value, index) => {
                    const selected = language === value;
                    return <button className={`theme-option ${selected ? "selected" : ""}`} key={value} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} autoFocus={selected} ref={(element) => { languageRefs.current[index] = element; }} onClick={() => onLanguageChange(value)} onKeyDown={handleLanguageKeyDown}>{t(value === "en" ? "english" : "simplifiedChinese")}</button>;
                  })}
                </div>
              </div>
            </section>
          ) : (
            <section className="settings-content" aria-labelledby="appearance-title">
              <header className="settings-page-header"><h3 id="appearance-title">{t("appearance")}</h3></header>
              <div className="setting-row setting-row-horizontal">
                <span className="setting-copy"><strong>{t("theme")}</strong><small>{t("themeDescription")}</small></span>
                <div className="theme-options" role="radiogroup" aria-label={t("theme")}>
                  {themes.map(({ value, label, Icon }, index) => {
                    const selected = theme === value;
                    return <button className={`theme-option ${selected ? "selected" : ""}`} key={value} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} autoFocus={selected} ref={(element) => { optionRefs.current[index] = element; }} onClick={() => onThemeChange(value)} onKeyDown={(event) => handleOptionKeyDown(event, index)}><Icon aria-hidden="true" size={15} strokeWidth={1.8} /><span>{t(label)}</span></button>;
                  })}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </dialog>
  );
}
