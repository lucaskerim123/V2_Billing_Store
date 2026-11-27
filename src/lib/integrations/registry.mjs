import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INTEGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../integrations");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  if (manifest.format !== "orbitfs-billing-integration-v1") return null;
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) return null;
  if (typeof manifest.displayName !== "string" || !manifest.displayName.trim()) return null;
  if (typeof manifest.version !== "string" || !manifest.version.trim()) return null;
  if (typeof manifest.publisher !== "string" || !manifest.publisher.trim()) return null;
  if (manifest.distribution !== "bundled" || manifest.installable !== true || manifest.serverOnly !== true) return null;
  if (!Array.isArray(manifest.requires) || !manifest.requires.every((item) => typeof item === "string" && /^[A-Z][A-Z0-9_]*$/.test(item))) return null;
  if (!manifest.entrypoints || typeof manifest.entrypoints !== "object" || Array.isArray(manifest.entrypoints)) return null;
  for (const [name, target] of Object.entries(manifest.entrypoints)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name) || typeof target !== "string" || !target.startsWith("./") || target.includes("..") || target.includes("\\\\")) return null;
  }
  return Object.freeze({
    id: manifest.id,
    name: manifest.displayName,
    description: typeof manifest.description === "string" ? manifest.description : "",
    version: manifest.version,
    publisher: manifest.publisher,
    distribution: "bundled",
    installable: true,
    sourceRepository: typeof manifest.sourceRepository === "string" ? manifest.sourceRepository : "",
    sourcePath: typeof manifest.sourcePath === "string" ? manifest.sourcePath : "",
    billingExtensionPath: typeof manifest.billingExtensionPath === "string" ? manifest.billingExtensionPath : "",
    sourceWorkspaceBuildOnly: manifest.sourceWorkspaceBuildOnly === true,
    hostAdapted: manifest.hostAdapted === true,
    requiredEnvironment: [...manifest.requires],
    features: Array.isArray(manifest.features) ? manifest.features.filter((item) => typeof item === "string") : [],
    route: `/admin/integrations/${manifest.id}`,
    entrypoints: Object.freeze({ ...manifest.entrypoints })
  });
}

/**
 * Discover bundled integrations from <directory>/<integration-id>/manifest.json.
 * Only metadata is read. Entrypoint code is never dynamically imported or executed.
 */
export function discoverIntegrations(directory = DEFAULT_INTEGRATIONS_DIR) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  const found = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    const moduleDirectory = resolve(directory, entry.name);
    if (!moduleDirectory.startsWith(resolve(directory) + sep)) continue;
    const manifestPath = join(moduleDirectory, "manifest.json");
    try {
      if (!statSync(manifestPath).isFile()) continue;
      const manifest = normalizeManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
      if (!manifest || manifest.id !== entry.name || ids.has(manifest.id)) continue;
      ids.add(manifest.id);
      found.push(manifest);
    } catch {
      // Ignore incomplete or invalid integration folders; report them in CI tests.
    }
  }
  return Object.freeze(found.sort((a, b) => a.id.localeCompare(b.id)));
}

export const BUILTIN_INTEGRATIONS = discoverIntegrations();

export function getBuiltinIntegration(id) {
  return BUILTIN_INTEGRATIONS.find((item) => item.id === id) || null;
}

export function validateBuiltinIntegration(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  const discovered = getBuiltinIntegration(manifest.id);
  if (!discovered) return false;
  return manifest.publisher === discovered.publisher
    && manifest.version === discovered.version
    && (manifest.sourceRepository === undefined || manifest.sourceRepository === discovered.sourceRepository)
    && (manifest.sourcePath === undefined || manifest.sourcePath === discovered.sourcePath)
    && (manifest.billingExtensionPath === undefined || manifest.billingExtensionPath === discovered.billingExtensionPath)
    && (manifest.sourceWorkspaceBuildOnly === undefined || manifest.sourceWorkspaceBuildOnly === discovered.sourceWorkspaceBuildOnly)
    && (manifest.hostAdapted === undefined || manifest.hostAdapted === discovered.hostAdapted)
    && (manifest.distribution === undefined || manifest.distribution === "bundled");
}

export function canRunIntegration(state) {
  return state?.installed === true && state?.enabled === true;
}
