import { invoke } from "@tauri-apps/api/core";

const shell = document.querySelector("#appShell");
const qrCode = document.querySelector("#qrCode");
const sessionLabel = document.querySelector("#sessionLabel");
const statusBadge = document.querySelector("#statusBadge span");
const issueBanner = document.querySelector("#issueBanner");
const issueAction = document.querySelector("#issueAction");
const refreshButton = document.querySelector("#refreshCodeButton");
const copyButton = document.querySelector("#copyAddressButton");
const toast = document.querySelector("#toast");

let currentInfo;
let currentQr;
let toastTimer;

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1_800);
}

function updateCheck(prefix, ready, state, detail) {
  const check = document.querySelector(`#${prefix}Check`);
  check.textContent = ready ? "✓" : "!";
  check.className = `check-state ${ready ? "ready" : "blocked"}`;
  setText(`#${prefix}State`, state);
  setText(`#${prefix}Detail`, detail);
}

function render(info) {
  currentInfo = info;
  const connected = info.sessionActive;
  const inputReady = info.driverStatus === "ready";
  const networkReady = info.lanAvailable;
  const state = !networkReady ? "error" : connected ? "connected" : "ready";
  shell.dataset.state = state;

  const label = !networkReady ? "Network unavailable" : connected ? "Phone connected" : "Ready to pair";
  statusBadge.textContent = label;
  setText("#sidebarState", connected ? "Connected" : networkReady ? "Service running" : "Local only");
  setText("#sidebarAddress", `${info.address}:${info.port}`);
  setText("#serviceAddress", `${info.address}:${info.port}`);
  setText("#sessionValue", connected ? "Active" : "Waiting for phone");
  setText("#pairingTitle", connected ? "Phone connected" : "Scan to pair");
  setText(
    "#pairingDescription",
    connected
      ? "The encrypted control session is active. A fresh code will appear after the phone disconnects."
      : "Your phone opens the controller directly in its browser. Keep both devices on the same Wi-Fi network.",
  );

  if (connected) {
    qrCode.hidden = true;
    sessionLabel.hidden = false;
  } else {
    sessionLabel.hidden = true;
    qrCode.hidden = false;
    if (info.pairingQrSvg && info.pairingQrSvg !== currentQr) {
      currentQr = info.pairingQrSvg;
      qrCode.innerHTML = info.pairingQrSvg;
    }
  }

  copyButton.disabled = !info.pairingUrl;
  refreshButton.disabled = connected || !networkReady;
  updateCheck(
    "network",
    networkReady,
    networkReady ? "Available" : "Unavailable",
    networkReady ? `Listening on ${info.address}:${info.port}` : "No usable LAN address was found",
  );
  updateCheck(
    "input",
    inputReady,
    inputReady ? "Allowed" : "Permission required",
    inputReady ? "Pointer and keyboard events are enabled" : "Allow TouchDock in Accessibility settings",
  );
  setText("#readinessSummary", networkReady && inputReady ? "Ready for remote control" : "Action required");

  if (!networkReady) {
    issueBanner.hidden = false;
    issueAction.hidden = true;
    setText("#issueTitle", "Local network unavailable");
    setText("#issueBody", "Connect this computer to Wi-Fi or Ethernet, then reopen TouchDock.");
  } else if (!inputReady) {
    issueBanner.hidden = false;
    issueAction.hidden = info.platform !== "macos";
    setText("#issueTitle", "Input permission required");
    setText("#issueBody", "Allow TouchDock in System Settings → Privacy & Security → Accessibility.");
  } else {
    issueBanner.hidden = true;
    issueAction.hidden = true;
  }
}

issueAction.addEventListener("click", async () => {
  issueAction.disabled = true;
  try {
    const status = await invoke("request_input_permission");
    showToast(status === "ready" ? "Input access granted" : "Complete the macOS permission prompt");
    await refreshService();
  } catch {
    showToast("Could not request input permission");
  } finally {
    issueAction.disabled = false;
  }
});

function updateExpiry() {
  if (!currentInfo) return;
  if (currentInfo.sessionActive) {
    setText("#expiryText", "Encrypted session active");
    return;
  }
  const remaining = Math.max(0, currentInfo.pairingExpiresAtUnixMs - Date.now());
  const seconds = Math.ceil(remaining / 1_000);
  setText("#expiryText", seconds > 0 ? `Code expires in ${seconds}s` : "Refreshing code…");
}

async function refreshService() {
  try {
    render(await invoke("remote_service_info"));
  } catch {
    shell.dataset.state = "error";
    statusBadge.textContent = "Service stopped";
    issueBanner.hidden = false;
    setText("#issueTitle", "TouchDock service could not start");
    setText("#issueBody", "Quit and reopen the application. Another local service may be using the port.");
  }
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    render(await invoke("refresh_pairing_code"));
    showToast("New pairing code created");
  } catch {
    showToast("Cannot refresh while a phone is connected");
  } finally {
    refreshButton.disabled = !currentInfo || currentInfo.sessionActive || !currentInfo.lanAvailable;
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentInfo?.pairingUrl) return;
  try {
    await navigator.clipboard.writeText(currentInfo.pairingUrl);
    setText("#copyLabel", "Copied");
    showToast("Pairing address copied");
    window.setTimeout(() => setText("#copyLabel", "Copy address"), 1_500);
  } catch {
    showToast("Could not access the clipboard");
  }
});

for (const item of document.querySelectorAll("[data-view]")) {
  item.addEventListener("click", () => {
    const view = item.dataset.view;
    for (const button of document.querySelectorAll("[data-view]")) {
      const active = button === item;
      button.classList.toggle("active", active);
      button.toggleAttribute("aria-current", active);
    }
    for (const panel of document.querySelectorAll("[data-view-panel]")) {
      const active = panel.dataset.viewPanel === view;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    }
  });
}

await refreshService();
window.setInterval(refreshService, 1_000);
window.setInterval(updateExpiry, 250);
