import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CLIENT_PROOF_DOMAIN = bytes("touchdock-v1:client-proof");
const RESUME_PROOF_DOMAIN = bytes("touchdock-v1:resume-proof");
const SERVER_PROOF_DOMAIN = bytes("touchdock-v1:server-proof");
const KEY_DOMAIN = bytes("touchdock-v1:session-keys");
const C2S_LABEL = bytes("client-to-server");
const S2C_LABEL = bytes("server-to-client");
const C2S_NONCE_PREFIX = bytes("TDc1");
const S2C_NONCE_PREFIX = bytes("TDs1");

function bytes(value) {
  return encoder.encode(value);
}

function concat(...values) {
  const result = new Uint8Array(values.reduce((size, value) => size + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function hexToBytes(value) {
  if (!/^[0-9a-f]{2,}$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Pairing token is invalid");
  }
  return Uint8Array.from(value.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

export function encodeBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Base64 value is invalid");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sequenceBytes(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Sequence is invalid");
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(sequence), false);
  return result;
}

function nonce(prefix, sequence) {
  return concat(prefix, sequenceBytes(sequence));
}

function aad(label, sequence) {
  return concat(KEY_DOMAIN, label, sequenceBytes(sequence));
}

function deriveKeys(token, nonceValue, localPrivateKey, peerPublicKey, clientPublicKey, serverPublicKey) {
  const sharedPoint = p256.getSharedSecret(localPrivateKey, peerPublicKey);
  const sharedX = sharedPoint.slice(1);
  const context = concat(KEY_DOMAIN, nonceValue, clientPublicKey, serverPublicKey);
  const keys = {
    clientToServer: hkdf(sha256, sharedX, token, concat(context, C2S_LABEL), 32),
    serverToClient: hkdf(sha256, sharedX, token, concat(context, S2C_LABEL), 32),
  };
  sharedPoint.fill(0);
  sharedX.fill(0);
  return keys;
}

function createClientProof(token, nonceValue, clientPublicKey) {
  return hmac(sha256, token, concat(CLIENT_PROOF_DOMAIN, nonceValue, clientPublicKey));
}

function createServerProof(
  token,
  nonceValue,
  clientPublicKey,
  serverPublicKey,
  sessionId,
) {
  return hmac(
    sha256,
    token,
    concat(
      SERVER_PROOF_DOMAIN,
      nonceValue,
      clientPublicKey,
      serverPublicKey,
      bytes(sessionId),
    ),
  );
}

export function createEphemeralPrivateKey() {
  return p256.keygen().secretKey;
}

export function randomNonce() {
  const value = new Uint8Array(16);
  globalThis.crypto.getRandomValues(value);
  return value;
}

export function buildClientHello(token, clientPrivateKey, nonceValue) {
  const clientPublicKey = p256.getPublicKey(clientPrivateKey, false);
  const proof = createClientProof(token, nonceValue, clientPublicKey);
  return {
    clientPublicKey,
    message: {
      type: "client_hello",
      client_public_key: encodeBase64(clientPublicKey),
      client_nonce: encodeBase64(nonceValue),
      proof: encodeBase64(proof),
    },
  };
}

export function buildResumeHello(token, clientPrivateKey, nonceValue) {
  const clientPublicKey = p256.getPublicKey(clientPrivateKey, false);
  const proof = hmac(
    sha256,
    token,
    concat(RESUME_PROOF_DOMAIN, nonceValue, clientPublicKey),
  );
  return {
    clientPublicKey,
    message: {
      type: "resume_hello",
      client_public_key: encodeBase64(clientPublicKey),
      client_nonce: encodeBase64(nonceValue),
      proof: encodeBase64(proof),
    },
  };
}

export function completeClientHandshake({
  token,
  clientPrivateKey,
  clientPublicKey,
  nonce: nonceValue,
  serverHello,
}) {
  if (serverHello.type !== "server_hello" || serverHello.protocol_version !== 1) {
    throw new Error("Server protocol is unsupported");
  }
  const serverPublicKey = decodeBase64(serverHello.server_public_key);
  const receivedProof = decodeBase64(serverHello.proof);
  const expectedProof = createServerProof(
    token,
    nonceValue,
    clientPublicKey,
    serverPublicKey,
    serverHello.session_id,
  );
  if (!equalBytes(receivedProof, expectedProof)) {
    throw new Error("Server proof is invalid");
  }
  const keys = deriveKeys(
    token,
    nonceValue,
    clientPrivateKey,
    serverPublicKey,
    clientPublicKey,
    serverPublicKey,
  );
  return SecureChannel.client(keys);
}

export class SecureChannel {
  constructor({ inboundKey, outboundKey, inboundPrefix, outboundPrefix, inboundLabel, outboundLabel }) {
    this.inboundKey = inboundKey;
    this.outboundKey = outboundKey;
    this.inboundPrefix = inboundPrefix;
    this.outboundPrefix = outboundPrefix;
    this.inboundLabel = inboundLabel;
    this.outboundLabel = outboundLabel;
    this.expectedInboundSequence = 0;
    this.nextOutboundSequence = 0;
    this.closed = false;
  }

  static client(keys) {
    return new SecureChannel({
      inboundKey: keys.serverToClient,
      outboundKey: keys.clientToServer,
      inboundPrefix: S2C_NONCE_PREFIX,
      outboundPrefix: C2S_NONCE_PREFIX,
      inboundLabel: S2C_LABEL,
      outboundLabel: C2S_LABEL,
    });
  }

  static server(keys) {
    return new SecureChannel({
      inboundKey: keys.clientToServer,
      outboundKey: keys.serverToClient,
      inboundPrefix: C2S_NONCE_PREFIX,
      outboundPrefix: S2C_NONCE_PREFIX,
      inboundLabel: C2S_LABEL,
      outboundLabel: S2C_LABEL,
    });
  }

  static createServerHandshakeForTest({
    token,
    nonce: nonceValue,
    clientPublicKey,
    serverPrivateKey,
    sessionId,
  }) {
    const serverPublicKey = p256.getPublicKey(serverPrivateKey, false);
    const proof = createServerProof(
      token,
      nonceValue,
      clientPublicKey,
      serverPublicKey,
      sessionId,
    );
    const keys = deriveKeys(
      token,
      nonceValue,
      serverPrivateKey,
      clientPublicKey,
      clientPublicKey,
      serverPublicKey,
    );
    return {
      message: {
        type: "server_hello",
        protocol_version: 1,
        session_id: sessionId,
        server_public_key: encodeBase64(serverPublicKey),
        proof: encodeBase64(proof),
      },
      channel: SecureChannel.server(keys),
    };
  }

  encrypt(message) {
    if (this.closed) throw new Error("Secure channel is closed");
    const sequence = this.nextOutboundSequence;
    const plaintext = bytes(JSON.stringify(message));
    const ciphertext = gcm(
      this.outboundKey,
      nonce(this.outboundPrefix, sequence),
      aad(this.outboundLabel, sequence),
    ).encrypt(plaintext);
    this.nextOutboundSequence += 1;
    return { type: "encrypted", sequence, ciphertext: encodeBase64(ciphertext) };
  }

  decrypt(envelope) {
    if (this.closed) throw new Error("Secure channel is closed");
    if (
      envelope.type !== "encrypted" ||
      envelope.sequence !== this.expectedInboundSequence
    ) {
      throw new Error(
        `Message sequence mismatch: expected ${this.expectedInboundSequence}`,
      );
    }
    const plaintext = gcm(
      this.inboundKey,
      nonce(this.inboundPrefix, envelope.sequence),
      aad(this.inboundLabel, envelope.sequence),
    ).decrypt(decodeBase64(envelope.ciphertext));
    const message = JSON.parse(decoder.decode(plaintext));
    this.expectedInboundSequence += 1;
    return message;
  }

  destroy() {
    this.inboundKey.fill(0);
    this.outboundKey.fill(0);
    this.closed = true;
  }
}
