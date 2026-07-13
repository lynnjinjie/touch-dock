import { invoke } from "@tauri-apps/api/core";
import packageMetadata from "../package.json";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const CACHE_KEY = "touchdock.update-check";
const RELEASES_URL = "https://github.com/lynnjinjie/touch-dock/releases/latest";

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: number;
}

interface CachedUpdate {
  checkedAt: number;
  latestVersion: string;
  releaseUrl: string;
}

interface LatestRelease {
  version: string;
  releaseUrl: string;
}

export const currentVersion = packageMetadata.version;

function versionParts(version: string) {
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

export function isNewerVersion(candidate: string, installed: string) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next.numbers[index] !== current.numbers[index]) return next.numbers[index] > current.numbers[index];
  }
  if (next.prerelease === current.prerelease) return false;
  if (current.prerelease && !next.prerelease) return true;
  if (!current.prerelease && next.prerelease) return false;
  return (next.prerelease ?? "").localeCompare(current.prerelease ?? "", undefined, { numeric: true }) > 0;
}

function safeReleaseUrl(value: unknown) {
  if (typeof value !== "string") return RELEASES_URL;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && url.pathname.startsWith("/lynnjinjie/touch-dock/releases/") ? url.href : RELEASES_URL;
  } catch {
    return RELEASES_URL;
  }
}

function readCache(): CachedUpdate | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Partial<CachedUpdate> | null;
    if (value && typeof value.checkedAt === "number" && typeof value.latestVersion === "string" && typeof value.releaseUrl === "string") {
      return { checkedAt: value.checkedAt, latestVersion: value.latestVersion, releaseUrl: safeReleaseUrl(value.releaseUrl) };
    }
  } catch {
    // A malformed or unavailable cache should never block an update check.
  }
  return null;
}

function stateFromCache(cache: CachedUpdate | null): UpdateState {
  if (!cache) return { status: "idle", currentVersion };
  const available = isNewerVersion(cache.latestVersion, currentVersion);
  return {
    status: available ? "available" : "current",
    currentVersion,
    latestVersion: cache.latestVersion,
    releaseUrl: cache.releaseUrl,
    checkedAt: cache.checkedAt,
  };
}

export function readCachedUpdateState() {
  return stateFromCache(readCache());
}

export async function checkForUpdates(force = false): Promise<UpdateState> {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) return stateFromCache(cached);
  if (!("__TAURI_INTERNALS__" in window)) return stateFromCache(cached);

  const release = await invoke<LatestRelease | null>("latest_release");
  const next = {
    checkedAt: Date.now(),
    latestVersion: release?.version ?? currentVersion,
    releaseUrl: safeReleaseUrl(release?.releaseUrl),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  return stateFromCache(next);
}
