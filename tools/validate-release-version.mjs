import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargoManifest = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoManifest.match(/^version = "([^"]+)"$/m)?.[1];

if (!cargoVersion) {
  throw new Error("Could not read the package version from src-tauri/Cargo.toml");
}

const versions = new Set([packageVersion, tauriVersion, cargoVersion]);
if (versions.size !== 1) {
  throw new Error(
    `Release versions do not match: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion}`,
  );
}

const expectedTag = `v${packageVersion}`;
const actualTag = process.env.GITHUB_REF_NAME;
if (actualTag && actualTag !== expectedTag) {
  throw new Error(`Tag ${actualTag} does not match package version ${expectedTag}`);
}

console.log(`Release version ${packageVersion} is consistent`);
