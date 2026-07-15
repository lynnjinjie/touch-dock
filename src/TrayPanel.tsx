import { invoke } from "@tauri-apps/api/core";
import { Copy, ExternalLink, Power, RefreshCw, Settings, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { readLanguagePreference } from "./i18n";
import { applyTheme, readThemePreference, watchSystemTheme } from "./theme";

interface RemoteServiceInfo {
  pairingUrl: string | null;
  pairingQrSvg: string | null;
  pairingExpiresAtUnixMs: number;
  sessionActive: boolean;
  lanAvailable: boolean;
}

export function TrayPanel() {
  const zh = readLanguagePreference() === "zh-CN";
  const [info, setInfo] = useState<RemoteServiceInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const syncTheme = () => applyTheme(readThemePreference());
    syncTheme();
    window.addEventListener("focus", syncTheme);
    window.addEventListener("storage", syncTheme);
    const stopWatchingSystem = watchSystemTheme(syncTheme);
    return () => {
      window.removeEventListener("focus", syncTheme);
      window.removeEventListener("storage", syncTheme);
      stopWatchingSystem();
    };
  }, []);

  useEffect(() => {
    const refresh = () => void invoke<RemoteServiceInfo>("remote_service_info").then(setInfo).catch(() => setInfo(null));
    refresh();
    const serviceTimer = window.setInterval(refresh, 1_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 500);
    return () => { window.clearInterval(serviceTimer); window.clearInterval(clockTimer); };
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") void invoke("close_tray_panel");
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const status = info?.sessionActive
    ? (zh ? "手机已连接" : "Phone connected")
    : !info?.lanAvailable
      ? (zh ? "局域网不可用" : "Local network unavailable")
      : (zh ? "扫描二维码连接" : "Scan to connect");
  const connected = info?.sessionActive ?? false;
  const expiry = useMemo(() => {
    if (!info || info.sessionActive) return "";
    const seconds = Math.ceil(Math.max(0, info.pairingExpiresAtUnixMs - now) / 1_000);
    return zh ? `${seconds} 秒后刷新` : `Refreshes in ${seconds}s`;
  }, [info, now, zh]);

  async function copyAddress() {
    if (!info?.pairingUrl) return;
    await navigator.clipboard.writeText(info.pairingUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function refreshCode() {
    setRefreshing(true);
    try { setInfo(await invoke<RemoteServiceInfo>("refresh_pairing_code")); } finally { setRefreshing(false); }
  }

  return <main className="tray-panel-shell">
    <header className="tray-panel-header"><span><strong>TouchDock</strong><small>{status}</small></span></header>
    <section className="tray-qr-area">
      <div className={`tray-qr${connected ? " is-connected" : ""}`}>
        {connected
          ? <div className="tray-connected-state" role="status"><span aria-hidden="true" /><strong>{zh ? "连接已建立" : "Connected"}</strong><small>{zh ? "手机断开后会生成新的二维码" : "A new QR code appears after disconnecting"}</small></div>
          : info?.pairingQrSvg
            ? <div className="tray-qr-svg" dangerouslySetInnerHTML={{ __html: info.pairingQrSvg }} />
            : <span>{info && !info.lanAvailable ? (zh ? "局域网不可用" : "Local network unavailable") : (zh ? "正在准备二维码…" : "Preparing QR code…")}</span>}
      </div>
      <small>{expiry}</small>
    </section>
    <p className="tray-network-note"><Wifi aria-hidden="true" size={14} /><span>{zh ? "手机和电脑需连接同一 Wi‑Fi" : "Phone and computer must use the same Wi-Fi"}</span></p>
    <div className="tray-panel-actions">
      <button type="button" disabled={!info?.pairingUrl} onClick={() => void copyAddress()}><Copy size={14} /><span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制地址" : "Copy address")}</span></button>
      <button type="button" disabled={refreshing || info?.sessionActive || !info?.lanAvailable} onClick={() => void refreshCode()}><RefreshCw size={14} /><span>{refreshing ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新二维码" : "Refresh code")}</span></button>
    </div>
    <footer className="tray-panel-footer">
      <button type="button" onClick={() => void invoke("open_main_window")}><ExternalLink size={14} />{zh ? "打开 TouchDock" : "Open TouchDock"}</button>
      <span><button type="button" aria-label={zh ? "设置" : "Settings"} title={zh ? "设置" : "Settings"} onClick={() => void invoke("open_settings_window")}><Settings size={14} /></button><button type="button" aria-label={zh ? "退出 TouchDock" : "Quit TouchDock"} title={zh ? "退出 TouchDock" : "Quit TouchDock"} onClick={() => void invoke("quit_touchdock")}><Power size={14} /></button></span>
    </footer>
  </main>;
}
