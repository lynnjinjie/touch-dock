import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LayoutPanelTop, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { SettingsDialog } from "./SettingsDialog";
import { ControlLayoutView } from "./ControlLayoutView";
import { createTranslator, readLanguagePreference, saveLanguagePreference, type LanguagePreference } from "./i18n";
import { applyTheme, readThemePreference, saveThemePreference, watchSystemTheme, type ThemePreference } from "./theme";
import appIcon from "../src-tauri/icons/128x128.png";

type DriverStatus = "ready" | "permission_required" | "unsupported";
type View = "connect" | "layout";
const OPEN_SETTINGS_EVENT = "open-settings";

interface RemoteServiceInfo {
  protocolVersion: number;
  platform: string;
  address: string;
  port: number;
  websocketUrl: string;
  pairingToken: string | null;
  pairingUrl: string | null;
  pairingQrSvg: string | null;
  pairingExpiresAtUnixMs: number;
  sessionActive: boolean;
  lanAvailable: boolean;
  transportEncrypted: boolean;
  driverStatus: DriverStatus;
}

interface ToastState {
  id: number;
  message: string;
}

function ReadinessRow({
  label,
  detail,
  ready,
  state,
}: {
  label: string;
  detail: string;
  ready: boolean;
  state: string;
}) {
  return (
    <div className="readiness-row">
      <span className={`check-state ${ready ? "ready" : "blocked"}`} aria-hidden="true">
        {ready ? "✓" : "!"}
      </span>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <em>{state}</em>
    </div>
  );
}

function App() {
  const [view, setView] = useState<View>("connect");
  const [info, setInfo] = useState<RemoteServiceInfo | null>(null);
  const [serviceFailed, setServiceFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [refreshingCode, setRefreshingCode] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy address");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  const [language, setLanguage] = useState<LanguagePreference>(readLanguagePreference);
  const toastTimer = useRef<number | undefined>(undefined);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const t = useMemo(() => createTranslator(language), [language]);

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message });
    toastTimer.current = window.setTimeout(() => setToast(null), 1_800);
  }, []);

  const refreshService = useCallback(async () => {
    try {
      const next = await invoke<RemoteServiceInfo>("remote_service_info");
      setInfo(next);
      setServiceFailed(false);
    } catch {
      setServiceFailed(true);
    }
  }, []);

  useEffect(() => {
    void refreshService();
    const serviceInterval = window.setInterval(() => void refreshService(), 1_000);
    const clockInterval = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(serviceInterval);
      window.clearInterval(clockInterval);
      window.clearTimeout(toastTimer.current);
    };
  }, [refreshService]);

  useEffect(() => {
    applyTheme(theme);
    saveThemePreference(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  useEffect(() => {
    saveLanguagePreference(language);
    document.documentElement.lang = language;
    setCopyLabel(createTranslator(language)("copyAddress"));
  }, [language]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen(OPEN_SETTINGS_EVENT, () => setSettingsOpen(true))
      .then((stopListening) => { unlisten = stopListening; })
      .catch(() => { /* Browser previews do not expose Tauri events. */ });
    return () => unlisten?.();
  }, []);

  function closeSettings() {
    setSettingsOpen(false);
    window.setTimeout(() => settingsButtonRef.current?.focus(), 0);
  }

  const connected = info?.sessionActive ?? false;
  const networkReady = info?.lanAvailable ?? false;
  const inputReady = info?.driverStatus === "ready";
  const appState = serviceFailed || (info && !networkReady) ? "error" : connected ? "connected" : info ? "ready" : "loading";
  const address = info ? `${info.address}:${info.port}` : t("localService");
  const statusLabel = serviceFailed
    ? t("serviceStopped")
    : !info
      ? t("starting")
      : !networkReady
        ? t("networkUnavailable")
        : connected
          ? t("phoneConnected")
          : t("readyToPair");

  const expiryText = useMemo(() => {
    if (!info) return t("generatingCode");
    if (connected) return t("encryptedSessionActive");
    const seconds = Math.ceil(Math.max(0, info.pairingExpiresAtUnixMs - now) / 1_000);
    return seconds > 0 ? t("codeExpires", { seconds }) : t("refreshingCode");
  }, [connected, info, now, t]);

  const issue = serviceFailed
    ? { title: t("serviceStartFailed"), body: t("serviceStartFailedBody"), action: false }
    : info && !networkReady
      ? { title: t("localNetworkUnavailable"), body: t("localNetworkUnavailableBody"), action: false }
      : info && !inputReady
        ? { title: t("inputPermissionRequired"), body: t("inputPermissionBody"), action: info.platform === "macos" }
        : null;

  async function requestPermission() {
    setRequestingPermission(true);
    try {
      const status = await invoke<DriverStatus>("request_input_permission");
      showToast(status === "ready" ? t("inputAccessGranted") : t("completePermissionPrompt"));
      await refreshService();
    } catch {
      showToast(t("permissionRequestFailed"));
    } finally {
      setRequestingPermission(false);
    }
  }

  async function refreshCode() {
    setRefreshingCode(true);
    try {
      setInfo(await invoke<RemoteServiceInfo>("refresh_pairing_code"));
      showToast(t("newCodeCreated"));
    } catch {
      showToast(t("refreshConnectedError"));
    } finally {
      setRefreshingCode(false);
    }
  }

  async function copyAddress() {
    if (!info?.pairingUrl) return;
    try {
      await navigator.clipboard.writeText(info.pairingUrl);
      setCopyLabel(t("copied"));
      showToast(t("addressCopied"));
      window.setTimeout(() => setCopyLabel(t("copyAddress")), 1_500);
    } catch {
      showToast(t("clipboardError"));
    }
  }

  return (
    <>
      <div className="app-shell" data-state={appState}>
        <aside className="sidebar">
          <div className="brand"><img className="brand-icon" src={appIcon} alt="" /><span><strong>TouchDock</strong><small>{t("localRemote")}</small></span></div>
          <nav className="navigation" aria-label="TouchDock">
            <button className={`nav-item ${view === "connect" ? "active" : ""}`} type="button" aria-current={view === "connect" ? "page" : undefined} onClick={() => setView("connect")}><span className="nav-icon" aria-hidden="true">⌁</span>{t("connect")}</button>
            <button className={`nav-item ${view === "layout" ? "active" : ""}`} type="button" aria-current={view === "layout" ? "page" : undefined} onClick={() => setView("layout")}><span className="nav-icon" aria-hidden="true"><LayoutPanelTop size={15} /></span>{t("controlLayout")}</button>
          </nav>
          <div className="sidebar-footer">
            <span className="service-light" aria-hidden="true"></span>
            <span className="service-copy"><strong>{connected ? t("connected") : networkReady ? t("serviceRunning") : info ? t("localOnly") : t("starting")}</strong><small>{address}</small></span>
            <button ref={settingsButtonRef} className="settings-button" type="button" aria-label={t("settings")} title={t("settings")} onClick={() => setSettingsOpen(true)}>
              <Settings aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </div>
        </aside>

        <main className="content">
          {view === "layout" ? <ControlLayoutView language={language} /> : (
            <section className="view active">
              <header className="page-header"><div><h1>{t("connectPhone")}</h1><p>{t("scanCurrentCode")}</p></div><div className="status-badge" role="status" aria-live="polite"><i aria-hidden="true"></i><span>{statusLabel}</span></div></header>

              {issue && <section className="issue-banner" role="alert"><span className="issue-icon" aria-hidden="true">!</span><div><strong>{issue.title}</strong><p>{issue.body}</p></div>{issue.action && <button className="issue-action" type="button" disabled={requestingPermission} onClick={() => void requestPermission()}>{requestingPermission ? t("requesting") : t("requestAccess")}</button>}</section>}

              <section className="pairing-layout" aria-labelledby="pairingTitle">
                <div className="qr-column"><div className="qr-frame">{connected ? <div className="session-label">{t("phoneConnected")}</div> : <div className="qr-code" aria-label={t("pairingQrLabel")}>{info?.pairingQrSvg ? <div dangerouslySetInnerHTML={{ __html: info.pairingQrSvg }} /> : <span className="qr-placeholder">{t("preparingCode")}</span>}</div>}</div><div className="expiry">{expiryText}</div></div>
                <div className="pairing-copy"><div><h2 id="pairingTitle">{connected ? t("phoneConnected") : t("scanToPair")}</h2><p>{connected ? t("connectedDescription") : t("pairingDescription")}</p></div>
                  <dl className="connection-details"><div><dt>{t("address")}</dt><dd>{info ? address : t("starting")}</dd></div><div><dt>{t("session")}</dt><dd>{connected ? t("active") : t("waitingForPhone")}</dd></div><div><dt>{t("channel")}</dt><dd><span className="secure-dot" aria-hidden="true"></span>{t("encrypted")}</dd></div></dl>
                  <div className="actions"><button className="button secondary" type="button" disabled={!info?.pairingUrl} onClick={() => void copyAddress()}><span aria-hidden="true">▣</span><span>{copyLabel}</span></button><button className="button secondary" type="button" disabled={refreshingCode || connected || !networkReady} onClick={() => void refreshCode()}><span aria-hidden="true">↻</span>{refreshingCode ? t("refreshing") : t("newCode")}</button></div>
                </div>
              </section>

              <section className="readiness" aria-labelledby="readinessTitle"><div className="section-heading"><h2 id="readinessTitle">{t("readiness")}</h2><span>{networkReady && inputReady ? t("readyForControl") : t("actionRequired")}</span></div><div className="readiness-list"><ReadinessRow label={t("localNetwork")} ready={networkReady} state={networkReady ? t("available") : t("unavailable")} detail={networkReady ? t("listeningOn", { address }) : t("noLanAddress")} /><ReadinessRow label={t("inputControl")} ready={inputReady} state={inputReady ? t("allowed") : t("permissionRequired")} detail={inputReady ? t("inputEnabled") : t("accessibilityHint")} /></div></section>
              <details className="connection-help"><summary>{t("phoneCannotOpen")}</summary><p>{t("connectionHelp")}</p></details>
            </section>
          )}
        </main>
      </div>
      {settingsOpen && <SettingsDialog theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} onClose={closeSettings} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite" key={toast?.id}>{toast?.message}</div>
    </>
  );
}

export default App;
