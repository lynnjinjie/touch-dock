# TouchDock

TouchDock turns a phone browser on the same local network into a trackpad and keyboard for a computer. The desktop application handles secure pairing, connection state, and operating-system input control. The phone opens the controller by scanning a QR code and requires no mobile app installation.

> The repository includes a Rust LAN service, real QR pairing, a production mobile controller, short-lived single-use pairing tokens, encrypted session recovery, P-256 and AES-GCM application-layer encryption, and macOS and Windows input drivers. The React desktop UI reflects live native service state. Signed distribution and cross-platform CI are still in development.

## Current Capabilities

- Single-use QR pairing over the local network
- Encrypted `Reconnect` after lock screen, browser suspension, or temporary network loss without another scan
- Trackpad movement, adjustable pointer speed, left and right click, double click, hold, and scrolling
- A draggable separator for resizing the pointer and scroll regions
- Text entry, modifier keys, arrow keys, and common system shortcuts
- Explicit connecting, active, interrupted, failed, and disconnected states
- Platform input drivers for macOS and Windows

## Architecture

TouchDock uses Tauri 2 for the cross-platform desktop shell and isolates platform-specific input control behind Rust driver modules. The desktop WebView is implemented with React and TypeScript. The embedded mobile controller remains transport-focused and independent of Tauri APIs.

```text
Desktop UI          React 19 + TypeScript + Vite 7
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
├── index.html                 React desktop entry document
├── src/                       React and TypeScript desktop application
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
├── CHANGELOG.md               Versioned notable changes
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
3. Add production code signing and notarization for release installers.

## Continuous Integration and Releases

GitHub Actions runs the frontend build, mobile controller tests, and Rust tests on macOS and Windows for every push and pull request.

To publish a release, update the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, commit the change, then push a matching version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds TouchDock for Apple Silicon macOS, Intel macOS, and Windows, then creates a GitHub Release and uploads the installers. Unsigned artifacts can be built without repository secrets. Production distribution should configure the Apple and Windows signing credentials described by the Tauri signing documentation.

## Connection Lifecycle

The mobile client sends an encrypted heartbeat every 15 seconds. The desktop closes sessions after 45 seconds without a message and releases all held keys and mouse buttons. A paired phone can use **Reconnect** after lock screen, browser suspension, or a temporary network interruption. The resume credential is scoped to the desktop LAN origin, expires after 24 hours, and is invalidated when the user explicitly refreshes pairing on the desktop.

## Documentation

- [Product definition](PRODUCT.md)
- [Design system](DESIGN.md)
- [Changelog](CHANGELOG.md)
- [WebSocket protocol](docs/protocol.md)
- [Agent instructions](AGENTS.md)
