import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const DEFAULT_INTEGRATIONS_DIR = resolve(process.cwd(), "src/integrations");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;
const ROUTE_PATTERN = /^\/admin\/[a-z0-9\/-]+$/;

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  if (manifest.format !== "orbitfs-billing-integration-v1" || typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) return null;
  if (typeof manifest.displayName !== "string" || !manifest.displayName.trim() || typeof manifest.version !== "string" || !manifest.version.trim() || typeof manifest.publisher !== "string" || !manifest.publisher.trim()) return null;
  if (manifest.distribution !== "bundled" || manifest.installable !== true || manifest.serverOnly !== true) return null;
  if (!Array.isArray(manifest.requires) || !manifest.requires.every(item => typeof item === "string" && /^[A-Z][A-Z0-9_]*$/.test(item))) return null;
  if (!manifest.entrypoints || typeof manifest.entrypoints !== "object" || Array.isArray(manifest.entrypoints) || Object.keys(manifest.entrypoints).length===0) return null;
  for (const [name,target] of Object.entries(manifest.entrypoints)) if (!/^[a-z][A-Za-z0-9]*$/.test(name) || typeof target !== "string" || !target.startsWith("./") || target.includes("..") || target.includes("\\") || target.includes("/")) return null;
  const contributions=manifest.contributions||{};
  if (typeof contributions !== "object" || Array.isArray(contributions)) return null;
  const pages=Array.isArray(contributions.adminPages)?contributions.adminPages:[];
  if (!pages.every(p=>p&&typeof p==="object"&&typeof p.label==="string"&&p.label.trim()&&typeof p.route==="string"&&p.route===`/admin/integrations/${manifest.id}`&&typeof p.entrypoint==="string"&&Object.hasOwn(manifest.entrypoints,p.entrypoint)&&typeof p.permission==="string"&&/^[a-z][a-z0-9_.]+$/.test(p.permission))) return null;
  const menus=Array.isArray(contributions.adminMenu)?contributions.adminMenu:[];
  if (!menus.every(m=>m&&typeof m==="object"&&typeof m.label==="string"&&m.label.trim()&&typeof m.route==="string"&&pages.some(p=>p.route===m.route)&&typeof m.permission==="string"&&/^[a-z][a-z0-9_.]+$/.test(m.permission))) return null;
  return Object.freeze({
    id:manifest.id,name:manifest.displayName,description:typeof manifest.description==="string"?manifest.description:"",
    version:manifest.version,publisher:manifest.publisher,distribution:"bundled",installable:true,
    sourceRepository:typeof manifest.sourceRepository==="string"?manifest.sourceRepository:"",
    sourcePath:typeof manifest.sourcePath==="string"?manifest.sourcePath:"",
    billingExtensionPath:typeof manifest.billingExtensionPath==="string"?manifest.billingExtensionPath:"",
    sourceWorkspaceBuildOnly:manifest.sourceWorkspaceBuildOnly===true,hostAdapted:manifest.hostAdapted===true,
    requiredEnvironment:[...manifest.requires],features:Array.isArray(manifest.features)?manifest.features.filter(x=>typeof x==="string"):[],
    route:`/admin/integrations/${manifest.id}`,entrypoints:Object.freeze({...manifest.entrypoints}),
    contributions:Object.freeze({adminPages:Object.freeze(pages.map(p=>Object.freeze({...p}))),adminMenu:Object.freeze(menus.map(m=>Object.freeze({...m})))})
  });
}

/** Scan src/integrations/<id>/manifest.json. Discovery is metadata-only: code is not loaded or run. */
export function discoverIntegrations(directory=DEFAULT_INTEGRATIONS_DIR){
  let entries;try{entries=readdirSync(directory,{withFileTypes:true});}catch(error){if(error?.code==="ENOENT")return Object.freeze([]);throw error;}
  const found=[],ids=new Set(),root=resolve(directory);
  for(const entry of entries){
    if(!entry.isDirectory()||!ID_PATTERN.test(entry.name))continue;
    const moduleDirectory=resolve(directory,entry.name);if(!moduleDirectory.startsWith(root+sep))continue;
    try{
      const manifestPath=join(moduleDirectory,"manifest.json");if(!statSync(manifestPath).isFile())continue;
      const manifest=normalizeManifest(JSON.parse(readFileSync(manifestPath,"utf8")));if(!manifest||manifest.id!==entry.name||ids.has(manifest.id))continue;
      const validFiles=Object.values(manifest.entrypoints).every(target=>{const path=resolve(moduleDirectory,target.slice(2));return path.startsWith(moduleDirectory+sep)&&statSync(path).isFile();});
      if(!validFiles)continue;ids.add(manifest.id);found.push(manifest);
    }catch{/* Invalid/incomplete folders are ignored. */}
  }
  return Object.freeze(found.sort((a,b)=>a.id.localeCompare(b.id)));
}
export const BUILTIN_INTEGRATIONS=discoverIntegrations();
export function getBuiltinIntegration(id){return BUILTIN_INTEGRATIONS.find(item=>item.id===id)||null;}
export function validateBuiltinIntegration(manifest){
  if(!manifest||typeof manifest!=="object")return false;const discovered=getBuiltinIntegration(manifest.id);if(!discovered)return false;
  return manifest.publisher===discovered.publisher&&manifest.version===discovered.version&&(manifest.sourceRepository===undefined||manifest.sourceRepository===discovered.sourceRepository)&&(manifest.sourcePath===undefined||manifest.sourcePath===discovered.sourcePath)&&(manifest.billingExtensionPath===undefined||manifest.billingExtensionPath===discovered.billingExtensionPath)&&(manifest.sourceWorkspaceBuildOnly===undefined||manifest.sourceWorkspaceBuildOnly===discovered.sourceWorkspaceBuildOnly)&&(manifest.hostAdapted===undefined||manifest.hostAdapted===discovered.hostAdapted)&&(manifest.distribution===undefined||manifest.distribution==="bundled");
}
export function canRunIntegration(state){return state?.installed===true&&state?.enabled===true;}
