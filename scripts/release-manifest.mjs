import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const head = git(["rev-parse", "HEAD"]);
const shallow = git(["rev-parse", "--is-shallow-repository"]);
if (shallow !== "false") {
  throw new Error("Release manifest requires complete Git history; repository is shallow.");
}

const requestedBase = String(process.env.RELEASE_BASE_SHA || "").trim();
let baseSha = "";
let baseSource = "repository-root";

if (requestedBase) {
  baseSha = git(["rev-parse", requestedBase]);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, head], { stdio: "ignore" });
  } catch {
    throw new Error(`Configured release base ${baseSha} is not an ancestor of HEAD ${head}; refusing to create an incomplete production change-set.`);
  }
  baseSource = "current-production-deployment";
}

let latestTag = "";
if (!baseSha) {
  try {
    latestTag = git(["describe", "--tags", "--abbrev=0", "HEAD"]);
    baseSha = git(["rev-parse", latestTag]);
    baseSource = "latest-tag";
  } catch {
    latestTag = "";
    baseSha = "";
  }
}

let commitLines = [];
let changedFiles = [];
let changedFileStatus = [];

if (baseSha && baseSha !== head) {
  commitLines = git(["log", "--reverse", "--format=%H%x09%an%x09%aI%x09%s", `${baseSha}..HEAD`])
    .split("\n")
    .filter(Boolean);
  changedFiles = git(["diff", "--name-only", `${baseSha}..HEAD`])
    .split("\n")
    .filter(Boolean);
  changedFileStatus = git(["diff", "--name-status", `${baseSha}..HEAD`])
    .split("\n")
    .filter(Boolean);
} else if (!baseSha) {
  commitLines = git(["log", "--reverse", "--format=%H%x09%an%x09%aI%x09%s", "HEAD"])
    .split("\n")
    .filter(Boolean);
  changedFiles = git(["ls-tree", "-r", "--name-only", "HEAD"])
    .split("\n")
    .filter(Boolean);
  changedFileStatus = changedFiles.map((path) => `A\t${path}`);
}

const commits = commitLines.map((line) => {
  const [sha, author, timestamp, ...subject] = line.split("\t");
  return { sha, author, timestamp, subject: subject.join("\t") };
});

const files = changedFileStatus.map((line) => {
  const parts = line.split("\t");
  const status = parts.shift() || "";
  return { status, paths: parts };
});

const branch = process.env.GITHUB_REF_NAME || git(["branch", "--show-current"]) || "detached";

const manifest = {
  schemaVersion: 2,
  repository: process.env.GITHUB_REPOSITORY ?? "lucaskerim123/V2_Billing_Store",
  branch,
  baseSha: baseSha || null,
  baseSource,
  headSha: head,
  previousReleaseTag: latestTag || null,
  commitCount: commits.length,
  commits,
  changedFileCount: changedFiles.length,
  changedFiles,
  fileChanges: files,
  cumulativeDeployment: true,
  generatedAt: new Date().toISOString()
};

writeFileSync("release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  baseSha: manifest.baseSha,
  baseSource: manifest.baseSource,
  headSha: manifest.headSha,
  commitCount: manifest.commitCount,
  changedFileCount: manifest.changedFileCount,
  cumulativeDeployment: manifest.cumulativeDeployment
}, null, 2));
