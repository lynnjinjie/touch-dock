import {
  buildClientHello,
  buildResumeHello,
  completeClientHandshake,
  createEphemeralPrivateKey,
  decodeBase64,
  hexToBytes,
  randomNonce,
} from "./crypto.js";
import { HoldState, TapDetector, clampPointerSpeed, normalizeUtilityKeyOrder, scalePointerDelta, scaleScrollDelta } from "./input-behavior.js";

const shell = document.querySelector("#remoteShell");
const connectionText = document.querySelector("#connectionText");
const notice = document.querySelector("#notice");
const noticeTitle = document.querySelector("#noticeTitle");
const noticeBody = document.querySelector("#noticeBody");
const retryButton = document.querySelector("#retryButton");
const trackpad = document.querySelector("#trackpad");
const scrollZone = document.querySelector("#scrollZone");
const textInput = document.querySelector("#textInput");

let socket;
let channel;
let token;
let resumeToken;
let requestId = 1;
let keepAlive;
let intentionalClose = false;
let pointerSpeed = 1;
let scrollSpeed = 1.3;
let currentLanguage = "en";

function setState(state, label) {
  shell.dataset.state = state;
  connectionText.textContent = label;
}

function showFailure(titleKey, bodyKey, retryable = false) {
  setState("failed", copy[currentLanguage].disconnected);
  noticeTitle.textContent = copy[currentLanguage][titleKey];
  noticeBody.textContent = copy[currentLanguage][bodyKey];
  retryButton.hidden = !retryable;
  notice.hidden = false;
}

function hideFailure() {
  notice.hidden = true;
  retryButton.hidden = true;
}

function readPairingToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const value = params.get("token");
  history.replaceState(null, "", location.pathname);
  return value ? hexToBytes(value) : null;
}

function saveResumeToken(value) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error("Resume token is invalid");
  resumeToken = value;
  try {
    localStorage.setItem("touchdock.resumeToken", btoa(String.fromCharCode(...value)));
  } catch {
    // Retry remains available while this page is alive when storage is unavailable.
  }
}

function clearResumeToken() {
  resumeToken?.fill(0);
  resumeToken = null;
  try {
    localStorage.removeItem("touchdock.resumeToken");
  } catch {
    // The in-memory credential is still cleared when persistent storage is unavailable.
  }
}

function readResumeToken() {
  const stored = localStorage.getItem("touchdock.resumeToken");
  if (!stored) return null;
  const value = Uint8Array.from(atob(stored), (character) => character.charCodeAt(0));
  if (value.length !== 32) throw new Error("Resume token is invalid");
  return value;
}

function websocketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function sendEncrypted(message) {
  if (!channel || socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(channel.encrypt(message)));
  return true;
}

function command(commandValue) {
  return sendEncrypted({ type: "command", request_id: requestId++, command: commandValue });
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

function setPointerSpeed(value) {
  pointerSpeed = clampPointerSpeed(value);
}

const copy = {
  en: {
    subtitle: "Remote control", connecting: "Connecting", connected: "Encrypted", disconnected: "Disconnected", reconnect: "Reconnect",
    trackpad: "Trackpad", keys: "Keys", actions: "Actions", move: "Move pointer", left: "Left click", right: "Right click",
    placeholder: "Type on your computer", sendText: "Send text", encrypted: "Commands encrypted on this device",
    invalidResponse: "Invalid response", invalidResponseBody: "The computer sent an unreadable response.", remoteBusy: "Remote already in use", remoteBusyBody: "Disconnect the other phone, then scan the new QR code.", pairingExpired: "Pairing expired", scanCurrentQr: "Scan the current QR code on your computer.", computerNotVerified: "Computer not verified", scanFromTouchDock: "Scan the current QR code directly from TouchDock.", permissionRequired: "Permission required", permissionBody: "Allow Accessibility or Input control on your computer, then scan again.", secureSessionEnded: "Secure session ended", secureSessionBody: "Scan the refreshed QR code to reconnect.", pairingMissing: "Pairing code missing", pairingMissingBody: "Scan the QR code shown by TouchDock on your computer.", computerUnavailable: "Computer unavailable", computerUnavailableBody: "Keep TouchDock open and confirm both devices use the same Wi-Fi.", connectionPaused: "Connection paused", connectionPausedBody: "Tap Reconnect to resume control.",
  },
  "zh-CN": {
    subtitle: "远程控制", connecting: "正在连接", connected: "已加密", disconnected: "已断开", reconnect: "重新连接",
    trackpad: "触控板", keys: "按键", actions: "快捷操作", move: "移动光标", left: "左键", right: "右键",
    placeholder: "在电脑上输入文字", sendText: "发送文字", encrypted: "命令已在此设备加密",
    invalidResponse: "响应无效", invalidResponseBody: "电脑返回了无法读取的响应。", remoteBusy: "遥控器正在使用", remoteBusyBody: "请先断开另一台手机，再扫描新的二维码。", pairingExpired: "配对已过期", scanCurrentQr: "请扫描电脑上当前显示的二维码。", computerNotVerified: "无法验证电脑", scanFromTouchDock: "请直接扫描 TouchDock 中当前显示的二维码。", permissionRequired: "需要输入权限", permissionBody: "请在电脑上允许辅助功能或输入控制权限，然后重新连接。", secureSessionEnded: "安全会话已结束", secureSessionBody: "请扫描刷新后的二维码重新连接。", pairingMissing: "缺少配对码", pairingMissingBody: "请扫描电脑 TouchDock 中显示的二维码。", computerUnavailable: "无法连接电脑", computerUnavailableBody: "请保持 TouchDock 开启，并确认两台设备连接到同一 Wi-Fi。", connectionPaused: "连接已暂停", connectionPausedBody: "轻点“重新连接”继续控制。",
  },
};
const keyPresentation = {
  en: { escape: ["esc", "Esc"], tab: ["⇥", "Tab"], space: ["", "Space"], backspace: ["⌫", "Delete"], enter: ["↵", "Enter"] },
  "zh-CN": { escape: ["esc", "Esc"], tab: ["⇥", "Tab"], space: ["", "空格"], backspace: ["⌫", "删除"], enter: ["↵", "回车"] },
};
const actionKeyLabel = { tab: "Tab", space: "Space", enter: "Enter", escape: "Esc", backspace: "Delete", delete: "Delete", arrow_up: "↑", arrow_down: "↓", f11: "F11" };
const actionKeySymbol = { tab: "⇥", space: "␣", enter: "↵", escape: "×", backspace: "⌫", delete: "⌦", arrow_up: "↑", arrow_down: "↓", f11: "F11" };
const modifierLabel = { meta: "⌘", control: "⌃", alt: "⌥", shift: "⇧" };
const systemPresentation = { volume_up: ["＋", "System audio"], volume_down: ["−", "System audio"], mute: ["×", "System audio"], play_pause: ["▶", "Media control"] };
const supportedSystemActions = new Set(Object.keys(systemPresentation));

function actionPresentation(commandValue) {
  if (commandValue.kind === "system") return systemPresentation[commandValue.action] ?? ["•", "System action"];
  const modifiers = commandValue.kind === "shortcut" ? commandValue.modifiers : [];
  const keyLabel = actionKeyLabel[commandValue.key] ?? commandValue.key.toUpperCase();
  const symbol = `${modifiers.map((value) => modifierLabel[value] ?? "").join("")}${actionKeySymbol[commandValue.key] ?? keyLabel}`;
  const detail = [...modifiers.map((value) => modifierLabel[value]), keyLabel].join(" + ");
  return [symbol, detail];
}

function applyLayout(layout) {
  const language = layout.language === "zh-CN" ? "zh-CN" : "en";
  currentLanguage = language;
  const text = copy[language];
  const builtInLabels = language === "zh-CN" ? { "switch-apps": "切换应用", search: "搜索", overview: "调度中心", desktop: "显示桌面", "show-desktop": "显示桌面", mute: "静音", "volume-up": "增大音量", "volume-down": "减小音量", "play-pause": "播放 / 暂停", "new-window": "新建窗口", "close-window": "关闭窗口", "quit-app": "退出应用", copy: "复制", paste: "粘贴", undo: "撤销" } : {};
  const builtInLabelByEnglish = language === "zh-CN" ? { "Switch apps": "切换应用", Search: "搜索", Overview: "调度中心", "Show desktop": "显示桌面", "Mute audio": "静音", "Volume up": "增大音量", "Volume down": "减小音量", "Play / Pause": "播放 / 暂停", "New window": "新建窗口", "Close window": "关闭窗口", "Quit application": "退出应用", Copy: "复制", Paste: "粘贴", Undo: "撤销" } : {};
  const builtInDetails = language === "zh-CN" ? { "System audio": "系统音频", "Media control": "媒体控制" } : {};
  document.documentElement.lang = language;
  document.title = language === "zh-CN" ? "TouchDock 遥控器" : "TouchDock Remote";
  document.querySelector("#remoteSubtitle").textContent = text.subtitle;
  document.querySelector("#trackpadTab").textContent = text.trackpad;
  document.querySelector("#keysTab").textContent = text.keys;
  document.querySelector("#shortcutsTab").textContent = text.actions;
  document.querySelector(".trackpad-center span").textContent = text.move;
  document.querySelector('[data-click="left"]').lastChild.textContent = text.left;
  document.querySelector('[data-click="right"]').lastChild.textContent = text.right;
  textInput.placeholder = text.placeholder;
  textInput.setAttribute("aria-label", text.placeholder);
  const sendTextButton = document.querySelector("#sendTextButton");
  sendTextButton.setAttribute("aria-label", text.sendText);
  sendTextButton.title = text.sendText;
  retryButton.textContent = text.reconnect;
  document.querySelector(".tabs").setAttribute("aria-label", language === "zh-CN" ? "遥控器控制区" : "Remote controls");
  trackpad.setAttribute("aria-label", language === "zh-CN" ? "触控板区域" : "Trackpad area");
  scrollZone.setAttribute("aria-label", language === "zh-CN" ? "垂直滚动区域" : "Vertical scroll area");
  document.querySelector(".direction-pad").setAttribute("aria-label", language === "zh-CN" ? "方向键" : "Arrow keys");
  document.querySelector("#modifierRow").setAttribute("aria-label", language === "zh-CN" ? "修饰键" : "Modifier keys");
  document.querySelector(".secure-state").lastChild.textContent = ` ${text.encrypted}`;
  setPointerSpeed(layout.trackpad.pointerSpeed);
  scrollSpeed = clampPointerSpeed(layout.trackpad.scrollSpeed);
  document.querySelector('[data-click="left"]').hidden = !layout.trackpad.showLeftClick;
  document.querySelector('[data-click="right"]').hidden = !layout.trackpad.showRightClick;
  document.querySelector("#modifierRow").hidden = !layout.trackpad.showModifiers;
  const utilityKeys = document.querySelector("#utilityKeys");
  utilityKeys.replaceChildren(...normalizeUtilityKeyOrder(layout.keys).map((item, slot) => {
    if (!item.visible) return null;
    const [symbol, label] = keyPresentation[language][item.id];
    const button = document.createElement("button");
    button.className = `utility-key utility-slot-${slot}${item.id === "space" ? " utility-key-space" : ""}`; button.type = "button"; button.dataset.key = item.id;
    button.setAttribute("aria-label", label);
    button.innerHTML = item.id === "space" ? `<i class="space-bar" aria-hidden="true"></i><small>${label}</small>` : `<span aria-hidden="true">${symbol}</span>${item.id === "escape" ? "" : `<small>${label}</small>`}`;
    return button;
  }).filter(Boolean));
  const actions = document.querySelector("#shortcutsPanel");
  actions.replaceChildren(...layout.actions.filter((item) => item.visible && (item.command.kind !== "system" || supportedSystemActions.has(item.command.action))).map((item) => {
    const [symbol, detail] = actionPresentation(item.command);
    const button = document.createElement("button");
    button.className = "shortcut"; button.type = "button"; button._command = item.command;
    const icon = document.createElement("span"); icon.className = "shortcut-icon"; icon.ariaHidden = "true"; icon.textContent = symbol;
    const labels = document.createElement("span"); const title = document.createElement("strong"); const small = document.createElement("small");
    title.textContent = builtInLabels[item.id] ?? builtInLabelByEnglish[item.label] ?? item.label;
    small.textContent = builtInDetails[detail] ?? detail;
    labels.append(title, small); button.append(icon, labels);
    return button;
  }));
}

try {
  const response = await fetch("/remote/config.json", { cache: "no-store" });
  if (response.ok) applyLayout(await response.json());
} catch {
  // The built-in defaults remain usable if configuration cannot be loaded.
}

function handleServerMessage(event, handshake) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    showFailure("invalidResponse", "invalidResponseBody");
    socket.close();
    return;
  }

  if (!channel) {
    if (message.type === "error") {
      const busy = message.code === "session_busy";
      if (handshake.isResume && !busy) clearResumeToken();
      showFailure(
        busy ? "remoteBusy" : "pairingExpired",
        busy ? "remoteBusyBody" : "scanCurrentQr",
      );
      socket.close();
      return;
    }
    try {
      channel = completeClientHandshake({ ...handshake, serverHello: message });
      handshake.clientPrivateKey.fill(0);
      handshake.nonce.fill(0);
      handshake.token.fill(0);
      token = null;
      setState("connected", copy[currentLanguage].connected);
      hideFailure();
      keepAlive = window.setInterval(() => {
        sendEncrypted({ type: "ping", nonce: Date.now() });
      }, 15_000);
    } catch {
      showFailure("computerNotVerified", "scanFromTouchDock");
      socket.close();
    }
    return;
  }

  try {
    const decrypted = channel.decrypt(message);
    if (decrypted.type === "session_ready") {
      try {
        saveResumeToken(decodeBase64(decrypted.resume_token));
      } catch {
        clearResumeToken();
      }
    } else if (decrypted.type === "error") {
      if (decrypted.code === "permission_required") {
        showFailure("permissionRequired", "permissionBody");
      } else if (!decrypted.retryable) {
        navigator.vibrate?.(30);
      }
    }
  } catch {
    showFailure("secureSessionEnded", "secureSessionBody");
    socket.close();
  }
}

function connect() {
  const isResume = !token && Boolean(resumeToken);
  const credential = token ?? resumeToken;
  if (!credential) {
    showFailure("pairingMissing", "pairingMissingBody");
    return;
  }
  intentionalClose = false;
  channel = null;
  hideFailure();
  setState("connecting", copy[currentLanguage].connecting);
  const clientPrivateKey = createEphemeralPrivateKey();
  const nonce = randomNonce();
  const handshakeToken = credential.slice();
  const hello = isResume
    ? buildResumeHello(handshakeToken, clientPrivateKey, nonce)
    : buildClientHello(handshakeToken, clientPrivateKey, nonce);
  const handshake = { token: handshakeToken, clientPrivateKey, clientPublicKey: hello.clientPublicKey, nonce, isResume };
  socket = new WebSocket(websocketUrl());
  socket.addEventListener("open", () => socket.send(JSON.stringify(hello.message)), { once: true });
  socket.addEventListener("message", (event) => handleServerMessage(event, handshake));
  socket.addEventListener("error", () => {
    if (!channel) showFailure("computerUnavailable", "computerUnavailableBody", Boolean(token || resumeToken));
  });
  socket.addEventListener("close", () => {
    window.clearInterval(keepAlive);
    if (channel && !intentionalClose) {
      showFailure("connectionPaused", "connectionPausedBody", Boolean(resumeToken));
    }
    channel?.destroy();
    channel = null;
  });
}

function activateTab(next) {
  const tabs = [...document.querySelectorAll("[role=tab]")];
  for (const tab of tabs) {
    const selected = tab === next;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.querySelector(`#${tab.getAttribute("aria-controls")}`);
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  }
}

for (const tab of document.querySelectorAll("[role=tab]")) {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll("[role=tab]")];
    const index = tabs.indexOf(tab);
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    activateTab(next);
    next.focus();
  });
}

let pointerState;
let pendingMove = { dx: 0, dy: 0 };
let moveFrame;
const tapDetector = new TapDetector();

function flushMove() {
  moveFrame = undefined;
  const { dx, dy } = pendingMove;
  pendingMove = { dx: 0, dy: 0 };
  if (dx || dy) command({ kind: "move", dx: clamp(dx, 500), dy: clamp(dy, 500) });
}

trackpad.addEventListener("pointerdown", (event) => {
  if (event.target === scrollZone || scrollZone.contains(event.target)) return;
  trackpad.setPointerCapture(event.pointerId);
  trackpad.classList.add("active");
  pointerState = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, started: performance.now() };
});

trackpad.addEventListener("pointermove", (event) => {
  if (!pointerState || event.pointerId !== pointerState.id) return;
  const dx = event.clientX - pointerState.x;
  const dy = event.clientY - pointerState.y;
  pointerState.x = event.clientX;
  pointerState.y = event.clientY;
  pointerState.distance += Math.hypot(dx, dy);
  const scaled = scalePointerDelta(dx * 1.35, dy * 1.35, pointerSpeed);
  pendingMove.dx += scaled.dx;
  pendingMove.dy += scaled.dy;
  if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
});

function finishPointer(event) {
  if (!pointerState || event.pointerId !== pointerState.id) return;
  const isTap = pointerState.distance < 8 && performance.now() - pointerState.started < 350;
  pointerState = undefined;
  trackpad.classList.remove("active");
  if (isTap) {
    const count = tapDetector.register({
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    });
    command(
      count === 2
        ? { kind: "click_state", button: "left", count }
        : { kind: "click", button: "left" },
    );
  }
}

trackpad.addEventListener("pointerup", finishPointer);
trackpad.addEventListener("pointercancel", finishPointer);

let scrollPointer;
scrollZone.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  scrollZone.setPointerCapture(event.pointerId);
  scrollPointer = { id: event.pointerId, y: event.clientY };
});
scrollZone.addEventListener("pointermove", (event) => {
  if (!scrollPointer || event.pointerId !== scrollPointer.id) return;
  const dy = event.clientY - scrollPointer.y;
  scrollPointer.y = event.clientY;
  if (Math.abs(dy) >= 1) command({ kind: "scroll", dx: 0, dy: clamp(scaleScrollDelta(-dy * 2, scrollSpeed), 1_000) });
});
scrollZone.addEventListener("pointerup", () => { scrollPointer = undefined; });
scrollZone.addEventListener("pointercancel", () => { scrollPointer = undefined; });

trackpad.addEventListener("wheel", (event) => {
  event.preventDefault();
  command({ kind: "scroll", dx: clamp(scaleScrollDelta(-event.deltaX, scrollSpeed), 1_000), dy: clamp(scaleScrollDelta(-event.deltaY, scrollSpeed), 1_000) });
}, { passive: false });

const activeReleases = new Set();

function bindHeldButton(button, onDown, onUp) {
  const hold = new HoldState(onDown, onUp);
  const stop = () => {
    hold.release();
    activeReleases.delete(stop);
    button.classList.remove("is-pressed");
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add("is-pressed");
    activeReleases.add(stop);
    hold.press();
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (event.detail === 0) {
      onDown();
      onUp();
    }
  });
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

for (const button of document.querySelectorAll("[data-click]")) {
  bindHeldButton(
    button,
    () => command({ kind: "mouse_button", button: button.dataset.click, state: "down" }),
    () => command({ kind: "mouse_button", button: button.dataset.click, state: "up" }),
  );
}

function pressKey(key) {
  command({ kind: "key", key, state: "down" });
  command({ kind: "key", key, state: "up" });
}

for (const button of document.querySelectorAll("[data-key]:not(.shortcut)")) {
  bindHeldButton(
    button,
    () => command({ kind: "key", key: button.dataset.key, state: "down" }),
    () => command({ kind: "key", key: button.dataset.key, state: "up" }),
  );
}

for (const button of document.querySelectorAll("[data-modifier]")) {
  bindHeldButton(
    button,
    () => command({ kind: "modifier", modifier: button.dataset.modifier, state: "down" }),
    () => command({ kind: "modifier", modifier: button.dataset.modifier, state: "up" }),
  );
}

for (const button of document.querySelectorAll(".shortcut")) {
  button.addEventListener("click", () => {
    const value = button._command;
    if (value.kind === "shortcut") command(value);
    else if (value.kind === "key") pressKey(value.key);
    else if (value.kind === "system" && ["volume_up", "volume_down", "mute", "play_pause"].includes(value.action)) command(value);
  });
}

function sendText() {
  const text = textInput.value.trim();
  if (!text) return;
  command({ kind: "text", text });
  textInput.value = "";
}

document.querySelector("#sendTextButton").addEventListener("click", sendText);
textInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendText();
  }
});

retryButton.addEventListener("click", connect);
document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });
document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
window.addEventListener("blur", () => {
  for (const release of [...activeReleases]) release();
});
window.addEventListener("pagehide", () => {
  for (const release of [...activeReleases]) release();
  intentionalClose = true;
  socket?.close();
});
window.addEventListener("pageshow", () => {
  if (resumeToken && socket?.readyState === WebSocket.CLOSED) {
    showFailure("connectionPaused", "connectionPausedBody", true);
  }
});

try {
  token = readPairingToken();
} catch {
  token = null;
}
try {
  resumeToken = readResumeToken();
  if (token) clearResumeToken();
} catch {
  clearResumeToken();
}
connect();
