# TouchDock

TouchDock 将同一局域网内的手机浏览器变成电脑的触控板和键盘。桌面端负责安全配对、连接状态和系统输入控制；手机端通过扫描二维码打开控制页面，无需安装 App。

> 当前仓库处于交互原型与桌面工程初始化阶段。界面和连接状态可以演示，但真实局域网服务、二维码配对和系统输入注入尚未接入。

## Planned Features

- 局域网内一次性二维码配对
- 触控板移动、左右点击和滚动
- 文本输入、修饰键和方向键
- 常用系统快捷键
- 清晰的连接、中断、失败和断开状态
- macOS 与 Windows 平台输入驱动

## Architecture

TouchDock 使用 Tauri 2 构建跨平台桌面壳，并把平台相关输入能力隔离在 Rust 驱动层中。

```text
Desktop UI          Vite + HTML/CSS/JavaScript
Mobile Controller   Browser UI + shared command protocol
Core Service        Rust HTTP/WebSocket, pairing and sessions
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
cd src-tauri && cargo check
```

The Vite development server uses `http://127.0.0.1:1420/`.

## Project Structure

```text
.
├── index.html                 Interactive desktop and mobile prototype
├── src-tauri/                 Tauri configuration and Rust application
│   ├── capabilities/          Minimum Tauri permission set
│   ├── icons/                 Cross-platform application icons
│   └── src/                   Rust entry points
├── PRODUCT.md                 Product definition
├── DESIGN.md                  UI system and interaction guidance
├── agent.md                   Engineering instructions for coding agents
└── skills-lock.json           Project-level agent skill sources
```

## Security Principles

- Bind remote control services to the local network only.
- Require an expiring, single-use pairing token.
- Reject commands before a session is authenticated.
- Rate-limit pointer, keyboard and shortcut commands.
- Keep macOS and Windows input permissions explicit and platform-specific.
- Never expose unrestricted shell execution through the mobile protocol.

## Roadmap

1. Define the typed remote command protocol and `InputDriver` interface.
2. Implement the local HTTP/WebSocket service and session lifecycle.
3. Add the macOS Accessibility and CGEvent driver.
4. Add the Windows SendInput driver and UIPI-aware errors.
5. Replace prototype state controls with live desktop state.
6. Add signing, packaging and cross-platform CI.

## Documentation

- [Product definition](PRODUCT.md)
- [Design system](DESIGN.md)
- [Agent instructions](agent.md)
