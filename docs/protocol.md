# TouchDock WebSocket Protocol v1

TouchDock serves `GET /remote` and `WS /ws` from the desktop LAN address. The default port is `4816`; when occupied, the service selects an available port and reports it through the Tauri `remote_service_info` command.

## Pairing URL

The QR code contains a two-minute, single-use 256-bit token in the URL fragment:

```text
http://192.168.1.20:4816/remote#token=<64 lowercase hex characters>
```

Fragments are not included in HTTP requests. The mobile page reads the token into memory and immediately removes the fragment from browser history. Only one remote session may be active; disconnecting rotates the pairing token without revoking an existing resume credential.

## Encrypted Handshake

The client creates an ephemeral P-256 key pair and a random 16-byte nonce. Binary fields use unpadded Base64URL.

```json
{
  "type": "client_hello",
  "client_public_key": "<uncompressed SEC1 P-256 public key>",
  "client_nonce": "<16 bytes>",
  "proof": "<HMAC-SHA256>"
}
```

The client proof is HMAC-SHA256 with the pairing token over `touchdock-v1:client-proof || client_nonce || client_public_key`. The server validates the proof atomically while consuming the token, creates its own ephemeral key pair, and replies:

```json
{
  "type": "server_hello",
  "protocol_version": 1,
  "session_id": "<random session id>",
  "server_public_key": "<uncompressed SEC1 P-256 public key>",
  "proof": "<HMAC-SHA256>"
}
```

The server proof binds the nonce, both public keys, and session ID. Both peers derive directional AES-256 keys from P-256 ECDH with HKDF-SHA256. The pairing token is the HKDF salt; protocol labels, nonce, and both public keys are included in the HKDF info.

Immediately after establishing encryption, the server sends a resume credential inside the encrypted channel:

```json
{"type":"session_ready","resume_token":"<32-byte Base64URL credential>"}
```

The mobile client stores this credential for the desktop LAN origin. It expires after 24 hours and is revoked when the desktop user explicitly refreshes pairing. Automatic QR expiry does not revoke it.

## Resume Handshake

After lock screen, browser suspension, or a temporary network interruption, the mobile client can open a new WebSocket and authenticate with a fresh ephemeral key pair and nonce:

```json
{
  "type": "resume_hello",
  "client_public_key": "<new uncompressed SEC1 P-256 public key>",
  "client_nonce": "<new 16-byte nonce>",
  "proof": "<HMAC-SHA256>"
}
```

The resume proof is HMAC-SHA256 with the resume credential over `touchdock-v1:resume-proof || client_nonce || client_public_key`. The server returns the same authenticated `server_hello` shape, derives fresh directional keys using the resume credential, and sends a new encrypted `session_ready`. Invalid, expired, revoked, or concurrent resume attempts are rejected and require a new QR scan.

## Encrypted Messages

Every message after `server_hello` uses an AES-256-GCM envelope:

```json
{"type":"encrypted","sequence":0,"ciphertext":"<Base64URL ciphertext and tag>"}
```

Client-to-server and server-to-client directions use separate keys, nonce prefixes, labels, and sequence counters. Sequence numbers start at zero and must be exact. Replayed, reordered, modified, or unauthenticated messages terminate the session.

The encrypted plaintext is one of the following protocol messages:

```json
{"type":"session_ready","resume_token":"<Base64URL credential>"}
{"type":"command","request_id":42,"command":{"kind":"move","dx":12.5,"dy":-4.0}}
{"type":"ack","request_id":42}
{"type":"ping","nonce":123}
{"type":"pong","nonce":123}
```

Supported command payloads:

```json
{"kind":"move","dx":12.5,"dy":-4.0}
{"kind":"click","button":"left"}
{"kind":"click_state","button":"left","count":2}
{"kind":"mouse_button","button":"left","state":"down"}
{"kind":"scroll","dx":0,"dy":24}
{"kind":"key","key":"arrow_up","state":"down"}
{"kind":"modifier","modifier":"meta","state":"down"}
{"kind":"shortcut","modifiers":["meta"],"key":"tab"}
{"kind":"system","action":"mute"}
{"kind":"text","text":"Hello"}
```

Shortcut modifiers may contain a unique combination of `meta`, `control`, `alt`, and `shift`. Shortcut main keys are the letters A-Z, Tab, Space, Enter, Escape, Backspace, Delete, Arrow Up, Arrow Down, and F11. A custom action may also send any supported main key without modifiers through the ordinary `key` command. The only currently approved system action is `mute`; locking the computer remains absent from the input protocol until a separately confirmed flow is implemented.

`click` is an atomic down/up pair. `click_state` carries the native click count used for trackpad double-click recognition. `mouse_button`, `key`, and `modifier` preserve explicit state: holding a mobile control sends one `down`, release sends `up`, and no implicit `up` is inserted while the control remains held. The macOS driver marks the second click-button down/up pair within 500ms with native click count 2; Windows uses the operating system's native double-click sequence. The server releases any tracked held inputs when a session disconnects.

## Limits

- The handshake must complete within five seconds.
- Sessions close after 45 seconds without a WebSocket message.
- The mobile client sends an encrypted heartbeat every 15 seconds.
- Resume credentials expire after 24 hours and never bypass the single-active-session rule.
- Messages and frames are limited to 4 KB.
- Commands use a 240-token burst and 240-token-per-second limit.
- Unknown fields and variants, non-finite numbers, oversized deltas, control characters, raw key codes, and unapproved shortcuts are rejected.
- Mobile assets use `no-store`, `no-referrer`, `nosniff`, and a restrictive Content Security Policy.

## Security Boundary

Application-layer encryption protects command confidentiality and integrity from passive LAN observers, authenticates both handshake peers through possession of the QR token or an encrypted-delivered resume credential, and rejects replay. Resume proofs always bind a fresh ephemeral public key and nonce; the credential itself is never sent in a plaintext handshake. The mobile assets are initially delivered over local HTTP; an active attacker able to replace that response could alter the JavaScript before the secure channel is established. Production distribution must add trusted asset delivery or authenticated local TLS to close that boundary.
