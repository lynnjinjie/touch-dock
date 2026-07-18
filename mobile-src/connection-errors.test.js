import assert from "node:assert/strict";
import test from "node:test";
import { classifyHandshakeError } from "./connection-errors.js";

test("explains an invalid resume credential instead of blaming the network", () => {
  assert.deepEqual(classifyHandshakeError("authentication_failed", true), {
    titleKey: "resumeInvalid",
    bodyKey: "resumeInvalidBody",
    clearResume: true,
  });
});

test("keeps concurrent sessions distinct from invalid resume credentials", () => {
  assert.deepEqual(classifyHandshakeError("session_busy", true), {
    titleKey: "remoteBusy",
    bodyKey: "remoteBusyBody",
    clearResume: false,
  });
});

test("keeps a rejected fresh pairing code in the pairing-expired state", () => {
  assert.deepEqual(classifyHandshakeError("authentication_failed", false), {
    titleKey: "pairingExpired",
    bodyKey: "scanCurrentQr",
    clearResume: false,
  });
});
