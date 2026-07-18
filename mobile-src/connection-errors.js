export function classifyHandshakeError(code, isResume) {
  if (code === "session_busy") {
    return { titleKey: "remoteBusy", bodyKey: "remoteBusyBody", clearResume: false };
  }
  if (isResume && (code === "authentication_failed" || code === "authentication_required")) {
    return { titleKey: "resumeInvalid", bodyKey: "resumeInvalidBody", clearResume: true };
  }
  return { titleKey: "pairingExpired", bodyKey: "scanCurrentQr", clearResume: isResume };
}
