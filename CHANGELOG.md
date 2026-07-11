# Changelog

All notable changes to this project are documented here.
This file follows the versioned format used by GitHub Releases and Conventional Commits-style sections.

## Unreleased

### Changed

- migrate the Tauri desktop frontend from imperative JavaScript to React 19 and strict TypeScript while preserving the existing Quiet Native interface
- align the Vite configuration, React entry point, and TypeScript project structure with the official Tauri 2 React template

### Build

- run frontend, mobile controller, and Rust tests on macOS and Windows for every push and pull request
- build Apple Silicon macOS, Intel macOS, and Windows installers and publish them to GitHub Releases for version tags

## [v0.1.0](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.1.0) - 2026-07-11

### Features

- replace the interactive prototype with a production Tauri 2 desktop application and embedded mobile controller ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add LAN HTTP and WebSocket hosting, QR pairing, live connection state, and macOS Accessibility permission handling ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add pointer movement, adjustable speed, left and right click, native double click, held mouse buttons, scrolling, text entry, keys, and shortcuts ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add a resizable mobile pointer and scroll layout with persisted user settings ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add macOS CGEvent and Windows SendInput drivers behind a shared Rust `InputDriver` interface ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add encrypted `Reconnect` support for lock screen, browser suspension, and temporary network interruptions ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))

### Bug Fixes

- release held keys and mouse buttons when a session ends or the mobile page becomes inactive ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- prevent iPhone text selection, touch callouts, and double-tap page zoom on remote controls ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- keep the mobile connection notice synchronized with the encrypted WebSocket state ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- preserve cursor movement at display edges so the macOS Dock can be revealed ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- mark the second macOS click-button event with the native double-click count ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))

### Security

- authenticate ephemeral P-256 handshakes and encrypt every post-handshake message with AES-256-GCM ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- add single-use pairing tokens, encrypted 24-hour resume credentials, sequence validation, command bounds, and rate limiting ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
- restrict mobile asset responses with no-store caching, no-referrer, nosniff, and a Content Security Policy ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))

### Documentation

- document product direction, Quiet Native design rules, architecture boundaries, protocol messages, security limitations, and development commands ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))

### Build

- add mobile bundling and tests, Rust unit and loopback integration tests, and a Windows driver cross-target check ([c88c579](https://github.com/lynnjinjie/touch-dock/commit/c88c579a11bbcfd137fef5a2a5b23fa1cc24c0be))
