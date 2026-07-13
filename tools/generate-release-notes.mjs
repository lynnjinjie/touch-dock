import { execFileSync } from "node:child_process";

const repository = process.env.GITHUB_REPOSITORY || "lynnjinjie/touch-dock";
const releaseTag = process.env.GITHUB_REF_NAME || "HEAD";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function previousTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "HEAD^"]);
  } catch {
    return "";
  }
}

const previous = previousTag();
const base = previous || git(["rev-list", "--max-parents=0", "HEAD"]);
const range = `${base}..HEAD`;
const lines = git(["log", "--reverse", "--format=%H%x09%s", range]).split("\n").filter(Boolean);

const categoryForType = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Documentation",
  style: "Styles",
  test: "Tests",
  build: "Build",
  ci: "Build",
  chore: "Maintenance",
};
const categoryOrder = ["Breaking Changes", "Features", "Bug Fixes", "Performance", "Refactoring", "Documentation", "Styles", "Tests", "Build", "Maintenance", "Other Changes"];
const groups = new Map();

for (const line of lines) {
  const [hash, subject] = line.split("\t", 2);
  const conventional = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  const type = conventional?.[1]?.toLowerCase();
  const scope = conventional?.[2];
  const breaking = Boolean(conventional?.[3]);
  const description = conventional?.[4] || subject;
  const category = breaking ? "Breaking Changes" : categoryForType[type] || "Other Changes";
  const prefix = scope ? `**${scope}:** ` : "";
  const shortHash = hash.slice(0, 7);
  const bullet = `- ${prefix}${description} ([${shortHash}](https://github.com/${repository}/commit/${hash}))`;
  groups.set(category, [...(groups.get(category) || []), bullet]);
}

const sections = categoryOrder
  .filter((category) => groups.has(category))
  .map((category) => `## ${category}\n\n${groups.get(category).join("\n")}`);

const compareUrl = `https://github.com/${repository}/compare/${base}...${releaseTag}`;
sections.push(`**Full Changelog:** [${previous || base.slice(0, 7)}...${releaseTag}](${compareUrl})`);
process.stdout.write(`${sections.join("\n\n")}\n`);
