# Changelog

All notable changes to this project are documented here.
This file follows the versioned format used by GitHub Releases and Conventional Commits-style sections.

## [v0.2.8](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.8) - 2026-07-15

### Build

- require an explicit repository variable before using Apple signing secrets and validate the Developer ID `.p12` before macOS packaging

## [v0.2.7](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.7) - 2026-07-15

### Bug Fixes

- explain how to replace a stale macOS Accessibility entry after an ad-hoc-signed application update
- restore optional Developer ID signing and notarization inputs in the macOS release workflow while validating partial secret configuration
- balance the mobile Escape and Delete keycaps with compact equal widths and explicit icon-label pairs

## [v0.2.6](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.6) - 2026-07-15

### Features

- adapt the mobile controller across compact phones, landscape orientation, and iPad-sized screens
- add a persistent divider for resizing the mobile pointer and scroll regions
- add same-Wi-Fi guidance to the menu-bar and system-tray pairing panel

### Bug Fixes

- keep the active macOS window visible when hiding TouchDock from the Dock

### Styles

- center the pairing-panel heading, improve QR spacing, and remove the redundant close button
- add the TouchDock product icon to the README

## [v0.2.5](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.5) - 2026-07-15

### Features

- replace copy, paste, and undo presets with new tab, quick search, and browser back/forward actions
- allow selecting and confirming multiple action presets in one step
- restore drag-handle reordering and allow added actions to be deleted
- keep built-in default actions available in Presets after deletion
- add a scannable QR popover with address copy and pairing refresh to the macOS menu bar and Windows system tray

## [v0.2.4](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.4) - 2026-07-14

### Features

- add a macOS-only setting to show or hide TouchDock in the Dock while keeping menu bar access available

### Styles

- reshape mobile utility keys into keyboard-like rows with a wide Space key and stable Escape, Delete, Tab, and Enter slots

## [v0.2.3](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.3) - 2026-07-14

### Features

- add staged media and application presets that are applied only after confirmation

### Bug Fixes

- preserve explicit macOS modifier flags across custom shortcut key-down and key-up events
- route volume and playback presets through the encrypted mobile channel to native macOS and Windows handlers
- use matching action icons in the layout editor and mobile preview
- replace the mobile controller placeholder mark and browser icon with the TouchDock product icon

## [v0.2.2](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.2) - 2026-07-13

### Bug Fixes

- apply a complete ad-hoc signature to the Apple Silicon app bundle so Gatekeeper no longer reports the downloaded application as damaged

## [v0.2.1](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.1) - 2026-07-13

### Build

- publish macOS releases for Apple Silicon only
- build macOS release artifacts without Apple signing secrets until valid Developer ID credentials are configured
- allow an existing release tag to be rerun manually for an Apple Silicon-only artifact repair

## [v0.2.0](https://github.com/lynnjinjie/touch-dock/releases/tag/v0.2.0) - 2026-07-13

### Features

- migrate the Tauri desktop frontend to React 19 and strict TypeScript while preserving the Quiet Native interface
- add persistent controller layouts for trackpad behavior, fixed-key visibility, action ordering, custom single keys, and multi-modifier shortcuts
- add a safe window-level shortcut recorder with immediate key feedback
- add English and Simplified Chinese interfaces with light, dark, and system themes
- add a macOS menu-bar and Windows system-tray menu for opening TouchDock and Settings
- add system mute support on macOS and Windows
- add startup release checks with a 24-hour interval, manual checks, a Settings badge, and scoped system-browser links
- replace the application and tray artwork with the Dock Bridge icon set

### Bug Fixes

- keep custom action name fields focused while typing and stop shortcut recording when returning to text input
- keep mobile labels synchronized with the desktop language and configured control layout
- keep shortcut symbols inside their icon containers and restore compact two-column action tiles
- apply configured scroll sensitivity without resizing the mobile scroll region

### Security

- validate persisted layouts and custom commands in Rust before serving them to the phone
- restrict update redirects and opener permissions to HTTPS TouchDock GitHub Release URLs
- release held modifiers, keys, and mouse buttons when the encrypted session ends

### Build

- run frontend, mobile controller, and Rust tests on macOS and Windows for every push and pull request
- add tagged GitHub Release packaging for macOS and Windows
- generate grouped GitHub Release notes from Conventional Commit history with commit and full-changelog links

### Documentation

- update product, design, protocol, development, release, and agent guidance for the current application

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
