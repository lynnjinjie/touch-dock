export type LanguagePreference = "en" | "zh-CN";

const STORAGE_KEY = "touchdock.language";

const en = {
  localRemote: "Local remote",
  connect: "Connect",
  security: "Security",
  controlLayout: "Control layout",
  settings: "Settings",
  closeSettings: "Close settings",
  connected: "Connected",
  serviceRunning: "Service running",
  localOnly: "Local only",
  starting: "Starting",
  localService: "Local service",
  serviceStopped: "Service stopped",
  networkUnavailable: "Network unavailable",
  phoneConnected: "Phone connected",
  readyToPair: "Ready to pair",
  generatingCode: "Generating a secure code…",
  encryptedSessionActive: "Encrypted session active",
  codeExpires: "Code expires in {seconds}s",
  refreshingCode: "Refreshing code…",
  serviceStartFailed: "TouchDock service could not start",
  serviceStartFailedBody: "Quit and reopen the application. Another local service may be using the port.",
  localNetworkUnavailable: "Local network unavailable",
  localNetworkUnavailableBody: "Connect this computer to Wi-Fi or Ethernet, then reopen TouchDock.",
  inputPermissionRequired: "Input permission required",
  inputPermissionBody: "Allow TouchDock in System Settings → Privacy & Security → Accessibility.",
  inputPermissionRecovery: "Already enabled after an update? Remove the old TouchDock entry, add /Applications/TouchDock.app again, then quit and reopen TouchDock.",
  requesting: "Requesting…",
  requestAccess: "Open settings",
  inputAccessGranted: "Input access granted",
  completePermissionPrompt: "Complete the macOS permission prompt. If TouchDock is already enabled, remove the old entry and add the current app again.",
  permissionRequestFailed: "Could not request input permission",
  newCodeCreated: "New pairing code created",
  refreshConnectedError: "Cannot refresh while a phone is connected",
  copied: "Copied",
  copyAddress: "Copy address",
  addressCopied: "Pairing address copied",
  clipboardError: "Could not access the clipboard",
  connectPhone: "Connect your phone",
  scanCurrentCode: "Scan the current code with your phone camera.",
  pairingQrLabel: "TouchDock pairing QR code",
  preparingCode: "Preparing code",
  scanToPair: "Scan to pair",
  connectedDescription: "The encrypted control session is active. A fresh code will appear after the phone disconnects.",
  pairingDescription: "Your phone opens the controller directly in its browser. Keep both devices on the same Wi-Fi network.",
  address: "Address",
  session: "Session",
  active: "Active",
  waitingForPhone: "Waiting for phone",
  channel: "Channel",
  encrypted: "Encrypted",
  refreshing: "Refreshing…",
  newCode: "New code",
  readiness: "Readiness",
  readyForControl: "Ready for remote control",
  actionRequired: "Action required",
  localNetwork: "Local network",
  available: "Available",
  unavailable: "Unavailable",
  listeningOn: "Listening on {address}",
  noLanAddress: "No usable LAN address was found",
  inputControl: "Input control",
  allowed: "Allowed",
  permissionRequired: "Permission required",
  inputEnabled: "Pointer and keyboard events are enabled",
  accessibilityHint: "Allow the current TouchDock app in Accessibility settings",
  phoneCannotOpen: "Phone cannot open the page?",
  connectionHelp: "Allow TouchDock in System Settings → Privacy & Security → Local Network, confirm both devices use the same Wi-Fi, and temporarily disconnect VPN software. Some guest networks block communication between devices.",
  securityDescription: "Current pairing and command-channel protections.",
  singleUsePairing: "Single-use pairing",
  singleUsePairingBody: "The QR token expires after two minutes and rotates after every session.",
  authenticatedEncryption: "Authenticated encryption",
  authenticatedEncryptionBody: "P-256 key agreement with directional AES-256-GCM command channels.",
  secureReconnect: "Secure reconnect",
  secureReconnectBody: "Encrypted resume credentials expire after 24 hours and can be revoked with a new code.",
  localNetworkOnly: "Local network only",
  localNetworkOnlyBody: "The controller service is not published to the internet.",
  commandAllowlist: "Command allowlist",
  commandAllowlistBody: "Only validated pointer, keyboard, text and approved shortcut commands are accepted.",
  on: "On",
  localHttpBoundary: "Local HTTP boundary",
  localHttpBoundaryBody: "Commands are encrypted after pairing. The initial phone page is delivered over local HTTP until trusted local TLS is added.",
  appearance: "Appearance",
  general: "General",
  theme: "Theme",
  themeDescription: "Choose how TouchDock looks on this computer.",
  light: "Light",
  dark: "Dark",
  system: "System",
  language: "Language",
  languageDescription: "Choose the display language for TouchDock.",
  showInDock: "Show in Dock",
  showInDockDescription: "Keep TouchDock in the macOS Dock. The menu bar icon remains available when this is off.",
  dockVisibilityFailed: "Could not update Dock visibility.",
  english: "English",
  simplifiedChinese: "简体中文",
  version: "Version {version}",
  checkForUpdates: "Check for updates",
  checkingForUpdates: "Checking…",
  automaticUpdateChecks: "TouchDock checks for updates at startup, at most once every 24 hours.",
  upToDate: "TouchDock is up to date.",
  updateAvailable: "Update available",
  newVersionAvailable: "Version {version} is available.",
  updateCheckFailed: "Could not check for updates. Try again later.",
  viewUpdate: "View update",
  openUpdateFailed: "Could not open the update page.",
} as const;

export type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  localRemote: "本地遥控器", connect: "连接", security: "安全", controlLayout: "控制布局", settings: "设置", closeSettings: "关闭设置",
  connected: "已连接", serviceRunning: "服务运行中", localOnly: "仅限本地", starting: "正在启动", localService: "本地服务",
  serviceStopped: "服务已停止", networkUnavailable: "网络不可用", phoneConnected: "手机已连接", readyToPair: "可以配对",
  generatingCode: "正在生成安全二维码…", encryptedSessionActive: "加密会话进行中", codeExpires: "二维码将在 {seconds} 秒后过期", refreshingCode: "正在刷新二维码…",
  serviceStartFailed: "TouchDock 服务无法启动", serviceStartFailedBody: "请退出并重新打开应用。其他本地服务可能正在占用端口。",
  localNetworkUnavailable: "本地网络不可用", localNetworkUnavailableBody: "请将电脑连接到 Wi-Fi 或以太网，然后重新打开 TouchDock。",
  inputPermissionRequired: "需要输入控制权限", inputPermissionBody: "请在系统设置 → 隐私与安全性 → 辅助功能中允许 TouchDock。",
  inputPermissionRecovery: "更新后已经开启仍无效？请删除列表中的旧 TouchDock，重新添加 /Applications/TouchDock.app，然后完全退出并重新打开 TouchDock。",
  requesting: "正在请求…", requestAccess: "打开系统设置", inputAccessGranted: "已获得输入控制权限", completePermissionPrompt: "请完成 macOS 权限设置。若 TouchDock 已经开启，请删除旧条目并重新添加当前应用。",
  permissionRequestFailed: "无法请求输入控制权限", newCodeCreated: "已生成新的配对二维码", refreshConnectedError: "手机连接时无法刷新二维码",
  copied: "已复制", copyAddress: "复制地址", addressCopied: "配对地址已复制", clipboardError: "无法访问剪贴板",
  connectPhone: "连接手机", scanCurrentCode: "使用手机相机扫描当前二维码。", pairingQrLabel: "TouchDock 配对二维码", preparingCode: "正在准备二维码",
  scanToPair: "扫码配对", connectedDescription: "加密控制会话已建立。手机断开后会显示新的二维码。",
  pairingDescription: "手机会直接在浏览器中打开控制器。请确保两台设备连接到同一 Wi-Fi 网络。",
  address: "地址", session: "会话", active: "进行中", waitingForPhone: "等待手机连接", channel: "通道", encrypted: "已加密", refreshing: "正在刷新…", newCode: "新二维码",
  readiness: "就绪状态", readyForControl: "可以远程控制", actionRequired: "需要操作", localNetwork: "本地网络", available: "可用", unavailable: "不可用",
  listeningOn: "正在监听 {address}", noLanAddress: "未找到可用的局域网地址", inputControl: "输入控制", allowed: "已允许", permissionRequired: "需要权限",
  inputEnabled: "鼠标和键盘事件已启用", accessibilityHint: "请在辅助功能设置中允许当前 TouchDock 应用", phoneCannotOpen: "手机无法打开页面？",
  connectionHelp: "请在系统设置 → 隐私与安全性 → 本地网络中允许 TouchDock，确认两台设备使用同一 Wi-Fi，并暂时断开 VPN。部分访客网络会阻止设备间通信。",
  securityDescription: "当前的配对与命令通道保护措施。", singleUsePairing: "一次性配对", singleUsePairingBody: "二维码令牌在两分钟后过期，并在每次会话后轮换。",
  authenticatedEncryption: "身份验证加密", authenticatedEncryptionBody: "使用 P-256 密钥协商和双向 AES-256-GCM 命令通道。",
  secureReconnect: "安全重连", secureReconnectBody: "加密的恢复凭据在 24 小时后过期，也可通过生成新二维码撤销。",
  localNetworkOnly: "仅限本地网络", localNetworkOnlyBody: "控制器服务不会发布到互联网。", commandAllowlist: "命令白名单",
  commandAllowlistBody: "仅接受经过验证的鼠标、键盘、文本和已批准的快捷键命令。", on: "已启用", localHttpBoundary: "本地 HTTP 边界",
  localHttpBoundaryBody: "配对后命令会被加密。在加入可信本地 TLS 前，初始手机页面仍通过本地 HTTP 提供。",
  appearance: "外观", general: "通用", theme: "主题", themeDescription: "选择 TouchDock 在这台电脑上的显示外观。", light: "浅色", dark: "深色", system: "跟随系统", language: "语言", languageDescription: "选择 TouchDock 的显示语言。", showInDock: "在 Dock 中显示", showInDockDescription: "控制 TouchDock 是否显示在 macOS Dock 中。关闭后仍可使用菜单栏图标。", dockVisibilityFailed: "无法更新 Dock 显示设置。", english: "English", simplifiedChinese: "简体中文",
  version: "版本 {version}", checkForUpdates: "检查更新", checkingForUpdates: "正在检查…", automaticUpdateChecks: "TouchDock 会在启动时检查更新，每 24 小时最多一次。", upToDate: "TouchDock 已是最新版本。", updateAvailable: "有可用更新", newVersionAvailable: "版本 {version} 已发布。", updateCheckFailed: "无法检查更新，请稍后重试。", viewUpdate: "查看更新", openUpdateFailed: "无法打开更新页面。",
};

const dictionaries = { en, "zh-CN": zhCN };

export function readLanguagePreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") return stored;
  } catch {
    // Fall back to the operating-system language when storage is unavailable.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function saveLanguagePreference(language: LanguagePreference) {
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* The current session still updates. */ }
}

export function createTranslator(language: LanguagePreference) {
  return (key: TranslationKey, values?: Record<string, string | number>) => {
    let text: string = dictionaries[language][key];
    for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}
