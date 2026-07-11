import assert from "node:assert/strict";
import test from "node:test";

import {
  SecureChannel,
  buildClientHello,
  buildResumeHello,
  completeClientHandshake,
  decodeBase64,
  encodeBase64,
  hexToBytes,
} from "./crypto.js";

const TOKEN = new Uint8Array(32).fill(0x42);
const NONCE = new Uint8Array(16).fill(0x24);
const CLIENT_PRIVATE_KEY = new Uint8Array(32).fill(3);
const SERVER_PRIVATE_KEY = new Uint8Array(32).fill(4);

test("base64url and token decoding round trip", () => {
  const value = hexToBytes("00a1ff");
  assert.deepEqual(value, new Uint8Array([0, 0xa1, 0xff]));
  assert.deepEqual(decodeBase64(encodeBase64(value)), value);
});

test("client hello proof is deterministic and hides the token", () => {
  const hello = buildClientHello(TOKEN, CLIENT_PRIVATE_KEY, NONCE);
  assert.equal(hello.message.type, "client_hello");
  assert.equal(JSON.stringify(hello.message).includes(encodeBase64(TOKEN)), false);
  assert.equal(decodeBase64(hello.message.client_nonce).length, 16);
  assert.equal(decodeBase64(hello.message.client_public_key).length, 65);
  assert.equal(hello.message.proof, "-nqbmb8nybLCTA1CeyiUifeobsSDVvGOjK-tIpkU9cM");
});

test("resume hello uses a distinct authenticated proof", () => {
  const pairing = buildClientHello(TOKEN, CLIENT_PRIVATE_KEY, NONCE);
  const resume = buildResumeHello(TOKEN, CLIENT_PRIVATE_KEY, NONCE);
  assert.equal(resume.message.type, "resume_hello");
  assert.notEqual(resume.message.proof, pairing.message.proof);
  assert.equal(JSON.stringify(resume.message).includes(encodeBase64(TOKEN)), false);
});

test("client verifies the server and derives interoperable channels", () => {
  const hello = buildClientHello(TOKEN, CLIENT_PRIVATE_KEY, NONCE);
  const server = SecureChannel.createServerHandshakeForTest({
    token: TOKEN,
    nonce: NONCE,
    clientPublicKey: hello.clientPublicKey,
    serverPrivateKey: SERVER_PRIVATE_KEY,
    sessionId: "session-1",
  });
  const client = completeClientHandshake({
    token: TOKEN,
    clientPrivateKey: CLIENT_PRIVATE_KEY,
    clientPublicKey: hello.clientPublicKey,
    nonce: NONCE,
    serverHello: server.message,
  });

  const command = { type: "ping", nonce: 7 };
  assert.deepEqual(server.channel.decrypt(client.encrypt(command)), command);
  const reply = { type: "pong", nonce: 7 };
  assert.deepEqual(client.decrypt(server.channel.encrypt(reply)), reply);
});

test("secure channel rejects replay and tampering", () => {
  const keys = {
    clientToServer: new Uint8Array(32).fill(5),
    serverToClient: new Uint8Array(32).fill(6),
  };
  const client = SecureChannel.client(keys);
  const server = SecureChannel.server(keys);
  const envelope = client.encrypt({ type: "ping", nonce: 1 });
  assert.deepEqual(server.decrypt(envelope), { type: "ping", nonce: 1 });
  assert.throws(() => server.decrypt(envelope), /sequence/i);

  const next = client.encrypt({ type: "ping", nonce: 2 });
  next.ciphertext = `${next.ciphertext.slice(0, -1)}A`;
  assert.throws(() => server.decrypt(next));
});

test("server proof cannot be reused for another session", () => {
  const hello = buildClientHello(TOKEN, CLIENT_PRIVATE_KEY, NONCE);
  const server = SecureChannel.createServerHandshakeForTest({
    token: TOKEN,
    nonce: NONCE,
    clientPublicKey: hello.clientPublicKey,
    serverPrivateKey: SERVER_PRIVATE_KEY,
    sessionId: "session-1",
  });
  server.message.session_id = "session-2";
  assert.throws(
    () =>
      completeClientHandshake({
        token: TOKEN,
        clientPrivateKey: CLIENT_PRIVATE_KEY,
        clientPublicKey: hello.clientPublicKey,
        nonce: NONCE,
        serverHello: server.message,
      }),
    /proof/i,
  );
});

test("destroying a channel clears keys and disables encryption", () => {
  const keys = {
    clientToServer: new Uint8Array(32).fill(5),
    serverToClient: new Uint8Array(32).fill(6),
  };
  const channel = SecureChannel.client(keys);
  channel.destroy();
  assert.deepEqual(keys.clientToServer, new Uint8Array(32));
  assert.deepEqual(keys.serverToClient, new Uint8Array(32));
  assert.throws(() => channel.encrypt({ type: "ping", nonce: 1 }), /closed/i);
});
