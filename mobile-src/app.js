import {
  buildClientHello,
  buildResumeHello,
  completeClientHandshake,
  createEphemeralPrivateKey,
  decodeBase64,
  hexToBytes,
  randomNonce,
} from "./crypto.js";
import { HoldState, TapDetector, clampPointerSpeed, clampScrollWidth, scalePointerDelta } from "./input-behavior.js";

const shell = document.querySelector("#remoteShell");
const connectionText = document.querySelector("#connectionText");
const notice = document.querySelector("#notice");
const noticeTitle = document.querySelector("#noticeTitle");
const noticeBody = document.querySelector("#noticeBody");
const retryButton = document.querySelector("#retryButton");
const trackpad = document.querySelector("#trackpad");
const scrollZone = document.querySelector("#scrollZone");
const scrollResizer = document.querySelector("#scrollResizer");
const textInput = document.querySelector("#textInput");
const pointerSpeedInput = document.querySelector("#pointerSpeed");
const pointerSpeedValue = document.querySelector("#pointerSpeedValue");

let socket;
let channel;
let token;
let resumeToken;
let requestId = 1;
let keepAlive;
let intentionalClose = false;
let pointerSpeed = 1;
let scrollZoneWidth = 38;

function setState(state, label) {
  shell.dataset.state = state;
  connectionText.textContent = label;
}

function showFailure(title, body, retryable = false) {
  setState("failed", "Disconnected");
  noticeTitle.textContent = title;
  noticeBody.textContent = body;
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
  pointerSpeedInput.value = String(pointerSpeed);
  pointerSpeedValue.value = `${pointerSpeed.toFixed(1)}×`;
  try {
    localStorage.setItem("touchdock.pointerSpeed", String(pointerSpeed));
  } catch {
    // Private browsing can disable persistent storage; the current setting still works.
  }
}

function setScrollZoneWidth(value) {
  const trackpadWidth = trackpad.getBoundingClientRect().width;
  scrollZoneWidth = clampScrollWidth(trackpadWidth, value);
  const maximumWidth = Math.max(38, trackpadWidth * 0.45);
  trackpad.style.setProperty("--scroll-zone-width", `${scrollZoneWidth}px`);
  scrollResizer.setAttribute("aria-valuenow", String(Math.round(scrollZoneWidth)));
  scrollResizer.setAttribute("aria-valuemax", String(Math.round(maximumWidth)));
  try {
    localStorage.setItem("touchdock.scrollWidth", String(scrollZoneWidth));
  } catch {
    // Private browsing can disable persistent storage; the current setting still works.
  }
}

function handleServerMessage(event, handshake) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    showFailure("Invalid response", "The computer sent an unreadable response.");
    socket.close();
    return;
  }

  if (!channel) {
    if (message.type === "error") {
      const busy = message.code === "session_busy";
      if (handshake.isResume && !busy) clearResumeToken();
      showFailure(
        busy ? "Remote already in use" : "Pairing expired",
        busy ? "Disconnect the other phone, then scan the new QR code." : "Scan the current QR code on your computer.",
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
      setState("connected", "Encrypted");
      hideFailure();
      keepAlive = window.setInterval(() => {
        sendEncrypted({ type: "ping", nonce: Date.now() });
      }, 15_000);
    } catch {
      showFailure("Computer not verified", "Scan the current QR code directly from TouchDock.");
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
        showFailure("Permission required", "Allow Accessibility or Input control on your computer, then scan again.");
      } else if (!decrypted.retryable) {
        navigator.vibrate?.(30);
      }
    }
  } catch {
    showFailure("Secure session ended", "Scan the refreshed QR code to reconnect.");
    socket.close();
  }
}

function connect() {
  const isResume = !token && Boolean(resumeToken);
  const credential = token ?? resumeToken;
  if (!credential) {
    showFailure("Pairing code missing", "Scan the QR code shown by TouchDock on your computer.");
    return;
  }
  intentionalClose = false;
  channel = null;
  hideFailure();
  setState("connecting", "Connecting");
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
    if (!channel) showFailure("Computer unavailable", "Keep TouchDock open and confirm both devices use the same Wi-Fi.", Boolean(token || resumeToken));
  });
  socket.addEventListener("close", () => {
    window.clearInterval(keepAlive);
    if (channel && !intentionalClose) {
      showFailure("Connection paused", "Tap Reconnect to resume control.", Boolean(resumeToken));
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
  if (Math.abs(dy) >= 1) command({ kind: "scroll", dx: 0, dy: clamp(-dy * 2, 1_000) });
});
scrollZone.addEventListener("pointerup", () => { scrollPointer = undefined; });
scrollZone.addEventListener("pointercancel", () => { scrollPointer = undefined; });

let resizePointer;
function finishResize(event) {
  if (event && resizePointer && event.pointerId !== resizePointer.id) return;
  resizePointer = undefined;
  scrollResizer.classList.remove("active");
}

scrollResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const trackpadBounds = trackpad.getBoundingClientRect();
  scrollResizer.setPointerCapture(event.pointerId);
  resizePointer = { id: event.pointerId, right: trackpadBounds.right };
  scrollResizer.classList.add("active");
});
scrollResizer.addEventListener("pointermove", (event) => {
  if (!resizePointer || event.pointerId !== resizePointer.id) return;
  event.preventDefault();
  event.stopPropagation();
  setScrollZoneWidth(resizePointer.right - event.clientX);
});
scrollResizer.addEventListener("pointerup", finishResize);
scrollResizer.addEventListener("pointercancel", finishResize);
scrollResizer.addEventListener("lostpointercapture", finishResize);
scrollResizer.addEventListener("keydown", (event) => {
  let nextWidth = scrollZoneWidth;
  if (event.key === "ArrowLeft") nextWidth += 8;
  else if (event.key === "ArrowRight") nextWidth -= 8;
  else if (event.key === "Home") nextWidth = 38;
  else if (event.key === "End") nextWidth = trackpad.getBoundingClientRect().width * 0.45;
  else return;
  event.preventDefault();
  setScrollZoneWidth(nextWidth);
});

trackpad.addEventListener("wheel", (event) => {
  event.preventDefault();
  command({ kind: "scroll", dx: clamp(-event.deltaX, 1_000), dy: clamp(-event.deltaY, 1_000) });
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

for (const button of document.querySelectorAll(".shortcut")) {
  button.addEventListener("click", () => {
    if (button.dataset.modifiers) {
      command({ kind: "shortcut", modifiers: button.dataset.modifiers.split(","), key: button.dataset.shortcutKey });
    } else {
      pressKey(button.dataset.key);
    }
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
pointerSpeedInput.addEventListener("input", () => setPointerSpeed(pointerSpeedInput.value));
window.addEventListener("resize", () => setScrollZoneWidth(scrollZoneWidth));
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
    showFailure("Connection paused", "Tap Reconnect to resume control.", true);
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
try {
  setPointerSpeed(localStorage.getItem("touchdock.pointerSpeed") ?? 1);
} catch {
  setPointerSpeed(1);
}
try {
  setScrollZoneWidth(localStorage.getItem("touchdock.scrollWidth") ?? 38);
} catch {
  setScrollZoneWidth(38);
}
connect();
