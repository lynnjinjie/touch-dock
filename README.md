# TouchDock

TouchDock 将同一局域网内的手机浏览器变成电脑的触控板和键盘。桌面端负责安全配对、连接状态和系统输入控制；手机端通过扫描二维码打开控制页面，无需安装 App。

> 当前仓库已实现 Rust 局域网服务、真实二维码、正式手机控制页面、短期一次性配对 token、加密断线恢复、P-256 + AES-GCM 应用层加密，以及 macOS/Windows 输入驱动。桌面连接状态已接入原生服务轮询；签名打包和跨平台 CI 仍在开发中。

## Current Capabilities

- 局域网内一次性二维码配对
- 锁屏、切后台或临时断网后的加密 `Reconnect`，无需重复扫码
- 触控板移动、可调速度、左右点击、双击、长按和滚动
- 可拖动分隔线调节指针区与滚动区宽度
- 文本输入、修饰键、方向键和常用系统快捷键
- 清晰的连接、中断、失败和断开状态
- macOS 与 Windows 平台输入驱动

## Architecture

TouchDock 使用 Tauri 2 构建跨平台桌面壳，并把平台相关输入能力隔离在 Rust 驱动层中。

```text
Desktop UI          Vite + HTML/CSS/JavaScript
Mobile Controller   Browser UI + bundled audited crypto primitives
Core Service        Rust HTTP/WebSocket, pairing, encryption and sessions
Input Drivers       macOS CGEvent / Windows SendInput
Desktop Shell       Tauri 2
```

## Requirements

- Node.js 22+
- pnpm 10+
- Rust stable
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools and WebView2

## Development

Install dependencies:

```bash
pnpm install
```

Run the browser-only frontend:

```bash
pnpm dev
```

Run the Tauri desktop application:

```bash
pnpm tauri dev
```

Build and verify:

```bash
pnpm build
pnpm test:mobile
cargo test --manifest-path src-tauri/Cargo.toml
```

Compile-check the Windows input driver from macOS or Linux without invoking Tauri's Windows resource compiler:

```bash
cargo check \
  --manifest-path tools/windows-driver-check/Cargo.toml \
  --target x86_64-pc-windows-msvc
```

The Vite development server uses `http://127.0.0.1:1420/`.

## Project Structure

```text
.
├── index.html                 Production desktop application shell
├── desktop.css                Quiet Native desktop visual system
├── desktop.js                 Live desktop service state and actions
├── mobile/                    Embedded mobile page and bundled controller
├── mobile-src/                Mobile controller source and crypto tests
├── src-tauri/                 Tauri configuration and Rust application
│   ├── capabilities/          Minimum Tauri permission set
│   ├── icons/                 Cross-platform application icons
│   └── src/                   Rust entry points
├── docs/protocol.md           WebSocket protocol and security boundaries
├── tools/                     Cross-target platform checks
├── PRODUCT.md                 Product definition
├── DESIGN.md                  UI system and interaction guidance
├── AGENTS.md                  Engineering instructions for coding agents
└── skills-lock.json           Project-level agent skill sources
```

## Security Principles

- Bind remote control services to the local network only.
- Require an expiring, single-use pairing token.
- Issue a 24-hour resume credential only through the encrypted channel; explicit pairing refresh revokes it.
- Keep the token in the QR URL fragment so it is not sent in the HTTP request.
- Authenticate an ephemeral P-256 handshake before accepting commands.
- Encrypt every post-handshake protocol message with AES-256-GCM.
- Reject replayed and out-of-sequence encrypted envelopes.
- Rate-limit pointer, keyboard and shortcut commands.
- Keep macOS and Windows input permissions explicit and platform-specific.
- Never expose unrestricted shell execution through the mobile protocol.

The command channel is authenticated and encrypted at the application layer even though it uses `ws://`. The mobile HTML and JavaScript are initially delivered over local HTTP, so an active LAN attacker could still replace those assets before the encrypted session starts. Production hardening should add a trusted asset-delivery mechanism or authenticated local TLS; passive network observers cannot read command payloads.

## Roadmap

1. Add explicit confirmation tokens for destructive system actions.
2. Add trusted mobile asset delivery or authenticated local TLS.
3. Add signed installers and cross-platform CI.

## Connection Lifecycle

The mobile client sends an encrypted heartbeat every 15 seconds. The desktop closes sessions after 45 seconds without a message and releases all held keys and mouse buttons. A paired phone can use **Reconnect** after lock screen, browser suspension, or a temporary network interruption. The resume credential is scoped to the desktop LAN origin, expires after 24 hours, and is invalidated when the user explicitly refreshes pairing on the desktop.

## Documentation

- [Product definition](PRODUCT.md)
- [Design system](DESIGN.md)
- [WebSocket protocol](docs/protocol.md)
- [Agent instructions](AGENTS.md)
