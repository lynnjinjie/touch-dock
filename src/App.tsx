import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type DriverStatus = "ready" | "permission_required" | "unsupported";
type View = "connect" | "security";

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

function SecurityView() {
  return (
    <section className="view active">
      <header className="page-header">
        <div><h1>Security</h1><p>Current pairing and command-channel protections.</p></div>
      </header>
      <section className="security-section">
        <div className="security-row"><span className="security-symbol" aria-hidden="true">1×</span><span><strong>Single-use pairing</strong><small>The QR token expires after two minutes and rotates after every session.</small></span><em>On</em></div>
        <div className="security-row"><span className="security-symbol" aria-hidden="true">⇄</span><span><strong>Authenticated encryption</strong><small>P-256 key agreement with directional AES-256-GCM command channels.</small></span><em>On</em></div>
        <div className="security-row"><span className="security-symbol" aria-hidden="true">↻</span><span><strong>Secure reconnect</strong><small>Encrypted resume credentials expire after 24 hours and can be revoked with a new code.</small></span><em>On</em></div>
        <div className="security-row"><span className="security-symbol" aria-hidden="true">⌂</span><span><strong>Local network only</strong><small>The controller service is not published to the internet.</small></span><em>On</em></div>
        <div className="security-row"><span className="security-symbol" aria-hidden="true">≡</span><span><strong>Command allowlist</strong><small>Only validated pointer, keyboard, text and approved shortcut commands are accepted.</small></span><em>On</em></div>
      </section>
      <section className="security-note">
        <strong>Local HTTP boundary</strong>
        <p>Commands are encrypted after pairing. The initial phone page is delivered over local HTTP until trusted local TLS is added.</p>
      </section>
    </section>
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
  const toastTimer = useRef<number | undefined>(undefined);

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

  const connected = info?.sessionActive ?? false;
  const networkReady = info?.lanAvailable ?? false;
  const inputReady = info?.driverStatus === "ready";
  const appState = serviceFailed || (info && !networkReady) ? "error" : connected ? "connected" : info ? "ready" : "loading";
  const address = info ? `${info.address}:${info.port}` : "Local service";
  const statusLabel = serviceFailed
    ? "Service stopped"
    : !info
      ? "Starting"
      : !networkReady
        ? "Network unavailable"
        : connected
          ? "Phone connected"
          : "Ready to pair";

  const expiryText = useMemo(() => {
    if (!info) return "Generating a secure code…";
    if (connected) return "Encrypted session active";
    const seconds = Math.ceil(Math.max(0, info.pairingExpiresAtUnixMs - now) / 1_000);
    return seconds > 0 ? `Code expires in ${seconds}s` : "Refreshing code…";
  }, [connected, info, now]);

  const issue = serviceFailed
    ? { title: "TouchDock service could not start", body: "Quit and reopen the application. Another local service may be using the port.", action: false }
    : info && !networkReady
      ? { title: "Local network unavailable", body: "Connect this computer to Wi-Fi or Ethernet, then reopen TouchDock.", action: false }
      : info && !inputReady
        ? { title: "Input permission required", body: "Allow TouchDock in System Settings → Privacy & Security → Accessibility.", action: info.platform === "macos" }
        : null;

  async function requestPermission() {
    setRequestingPermission(true);
    try {
      const status = await invoke<DriverStatus>("request_input_permission");
      showToast(status === "ready" ? "Input access granted" : "Complete the macOS permission prompt");
      await refreshService();
    } catch {
      showToast("Could not request input permission");
    } finally {
      setRequestingPermission(false);
    }
  }

  async function refreshCode() {
    setRefreshingCode(true);
    try {
      setInfo(await invoke<RemoteServiceInfo>("refresh_pairing_code"));
      showToast("New pairing code created");
    } catch {
      showToast("Cannot refresh while a phone is connected");
    } finally {
      setRefreshingCode(false);
    }
  }

  async function copyAddress() {
    if (!info?.pairingUrl) return;
    try {
      await navigator.clipboard.writeText(info.pairingUrl);
      setCopyLabel("Copied");
      showToast("Pairing address copied");
      window.setTimeout(() => setCopyLabel("Copy address"), 1_500);
    } catch {
      showToast("Could not access the clipboard");
    }
  }

  return (
    <>
      <div className="app-shell" data-state={appState}>
        <aside className="sidebar">
          <div className="brand"><span className="brand-icon" aria-hidden="true">T</span><span><strong>TouchDock</strong><small>Local remote</small></span></div>
          <nav className="navigation" aria-label="TouchDock">
            <button className={`nav-item ${view === "connect" ? "active" : ""}`} type="button" aria-current={view === "connect" ? "page" : undefined} onClick={() => setView("connect")}><span className="nav-icon" aria-hidden="true">⌁</span>Connect</button>
            <button className={`nav-item ${view === "security" ? "active" : ""}`} type="button" aria-current={view === "security" ? "page" : undefined} onClick={() => setView("security")}><span className="nav-icon" aria-hidden="true">◇</span>Security</button>
          </nav>
          <div className="sidebar-footer"><span className="service-light" aria-hidden="true"></span><span><strong>{connected ? "Connected" : networkReady ? "Service running" : info ? "Local only" : "Starting"}</strong><small>{address}</small></span></div>
        </aside>

        <main className="content">
          {view === "security" ? <SecurityView /> : (
            <section className="view active">
              <header className="page-header"><div><h1>Connect your phone</h1><p>Scan the current code with your phone camera.</p></div><div className="status-badge" role="status" aria-live="polite"><i aria-hidden="true"></i><span>{statusLabel}</span></div></header>

              {issue && <section className="issue-banner" role="alert"><span className="issue-icon" aria-hidden="true">!</span><div><strong>{issue.title}</strong><p>{issue.body}</p></div>{issue.action && <button className="issue-action" type="button" disabled={requestingPermission} onClick={() => void requestPermission()}>{requestingPermission ? "Requesting…" : "Request access"}</button>}</section>}

              <section className="pairing-layout" aria-labelledby="pairingTitle">
                <div className="qr-column"><div className="qr-frame">{connected ? <div className="session-label">Phone connected</div> : <div className="qr-code" aria-label="TouchDock pairing QR code">{info?.pairingQrSvg ? <div dangerouslySetInnerHTML={{ __html: info.pairingQrSvg }} /> : <span className="qr-placeholder">Preparing code</span>}</div>}</div><div className="expiry">{expiryText}</div></div>
                <div className="pairing-copy"><div><h2 id="pairingTitle">{connected ? "Phone connected" : "Scan to pair"}</h2><p>{connected ? "The encrypted control session is active. A fresh code will appear after the phone disconnects." : "Your phone opens the controller directly in its browser. Keep both devices on the same Wi-Fi network."}</p></div>
                  <dl className="connection-details"><div><dt>Address</dt><dd>{info ? address : "Starting…"}</dd></div><div><dt>Session</dt><dd>{connected ? "Active" : "Waiting for phone"}</dd></div><div><dt>Channel</dt><dd><span className="secure-dot" aria-hidden="true"></span>Encrypted</dd></div></dl>
                  <div className="actions"><button className="button secondary" type="button" disabled={!info?.pairingUrl} onClick={() => void copyAddress()}><span aria-hidden="true">▣</span><span>{copyLabel}</span></button><button className="button secondary" type="button" disabled={refreshingCode || connected || !networkReady} onClick={() => void refreshCode()}><span aria-hidden="true">↻</span>{refreshingCode ? "Refreshing…" : "New code"}</button></div>
                </div>
              </section>

              <section className="readiness" aria-labelledby="readinessTitle"><div className="section-heading"><h2 id="readinessTitle">Readiness</h2><span>{networkReady && inputReady ? "Ready for remote control" : "Action required"}</span></div><div className="readiness-list"><ReadinessRow label="Local network" ready={networkReady} state={networkReady ? "Available" : "Unavailable"} detail={networkReady ? `Listening on ${address}` : "No usable LAN address was found"} /><ReadinessRow label="Input control" ready={inputReady} state={inputReady ? "Allowed" : "Permission required"} detail={inputReady ? "Pointer and keyboard events are enabled" : "Allow TouchDock in Accessibility settings"} /></div></section>
              <details className="connection-help"><summary>Phone cannot open the page?</summary><p>Allow TouchDock in System Settings → Privacy &amp; Security → Local Network, confirm both devices use the same Wi-Fi, and temporarily disconnect VPN software. Some guest networks block communication between devices.</p></details>
            </section>
          )}
        </main>
      </div>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite" key={toast?.id}>{toast?.message}</div>
    </>
  );
}

export default App;
