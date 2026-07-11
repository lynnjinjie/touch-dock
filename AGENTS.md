# TouchDock Agent Guide

## Mission

Build TouchDock as a secure, low-latency local remote for macOS and Windows. A phone browser pairs with the desktop app and sends narrowly defined pointer, keyboard, scroll, and shortcut commands over the local network.

## Current State

- The repository contains a working Tauri 2 desktop application and embedded mobile controller.
- Desktop markup, styles, and service-driven behavior live in `index.html`, `desktop.css`, and `desktop.js`.
- Pairing, encrypted WebSocket transport, 24-hour session recovery, QR generation, mobile hosting, and macOS/Windows input injection are implemented.
- The desktop UI reflects live service, permission, token-expiry, and session state.

## Architecture Boundaries

- Keep shared protocol, pairing, session, and rate-limit logic in Rust.
- Define an `InputDriver` trait and implement it in platform modules selected with `cfg(target_os)`.
- Use macOS CGEvent and Accessibility APIs only in the macOS module.
- Use Win32 SendInput and explicit UIPI error handling only in the Windows module.
- Keep the mobile controller transport-agnostic and free of Tauri-only APIs.
- Do not let frontend messages invoke arbitrary Rust functions, shell commands, or raw key codes.

## Security Invariants

- No input command is accepted without an authenticated, unexpired session.
- Pairing tokens are random, single-use, short-lived, and never logged.
- Resume credentials are delivered only after encryption is established, expire after 24 hours, and are revoked by explicit pairing refresh.
- Listen on local interfaces and only advertise a valid LAN address; do not publish the service beyond the local network.
- Validate and bound every numeric input, text payload, key, modifier, and command rate.
- Stop accepting commands immediately after disconnect, interruption, or permission loss.
- Destructive actions such as locking the computer require an explicit confirmation path.
- Every post-handshake WebSocket message must remain authenticated and encrypted.
- Keep the local HTTP asset-delivery boundary explicit until trusted local TLS is implemented.

## UI Direction

- Follow `PRODUCT.md` and `DESIGN.md` before changing product behavior or visual language.
- Preserve the Quiet Native direction: restrained, precise, and state-led.
- Connection confidence and safety messaging take priority over decorative UI.
- Maintain WCAG AA contrast, visible focus states, reduced motion, and 44px touch targets.
- Keep macOS and Windows platform conventions where they improve familiarity.

## Engineering Practices

- Prefer small modules with explicit ownership over broad abstractions.
- Keep platform code behind stable traits; shared code must not import platform modules directly.
- Use structured serialization for protocol messages and reject unknown variants.
- Add focused tests for protocol parsing, session transitions, rate limiting, and command validation.
- Avoid adding dependencies when the standard library or an existing dependency is sufficient.
- Never commit credentials, signing certificates, pairing secrets, build output, or local session data.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm tauri dev
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path tools/windows-driver-check/Cargo.toml --target x86_64-pc-windows-msvc
```

Before finishing a change, run the smallest relevant checks. For changes crossing the frontend/Rust boundary, run both `pnpm build` and `cargo test --manifest-path src-tauri/Cargo.toml`.

## Repository Notes

- `src-tauri/capabilities/default.json` should stay minimal; justify new permissions.
- `src-tauri/tauri.conf.json` owns desktop window, bundle, CSP, and build configuration.
- Project-level agent skills live under `.agents/skills` and are tracked by `skills-lock.json`.
- Generated folders such as `dist`, `node_modules`, `src-tauri/target`, and local Impeccable sessions are ignored.
