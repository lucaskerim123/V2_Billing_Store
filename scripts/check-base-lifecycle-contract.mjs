import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(path,"utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

const deployer=read("src/lib/orbitfs-customer-deployer.ts");
const operations=read("src/lib/orbitfs-base-operations.ts");
const explicitRoute=read("src/app/api/orbitfs/installations/[id]/base/[action]/route.ts");
const legacyRoute=read("src/app/api/orbitfs/installations/[id]/deploy/route.ts");
const status=read("src/app/api/orbitfs/status/route.ts");
const portal=read("src/app/portal/orbitfs/page.tsx");
const migration=read("database/migrations/20260928020000_orbitfs_base_operation_ledger.sql");

const createProjectCalls=(deployer.match(/ensureVercelProject\(/g)||[]).length;
assert(createProjectCalls===1,"Base lifecycle invariant failed: customer deployer must have exactly one ensureVercelProject call site.");
assert(
  deployer.includes('if(action==="deploy"&&!install.vercel_project_id)install=await ensureVercelProject(install);'),
  "Base lifecycle invariant failed: only first Base install may create a Vercel project."
);
assert(
  deployer.includes('runBaseUpdateDeployment') &&
  deployer.includes('BASE_PROJECT_NOT_FOUND'),
  "Base lifecycle invariant failed: Base update must use the existing recorded project."
);
assert(
  deployer.includes("orbitfs_schema_migrations") &&
  deployer.includes("Published migrations are immutable") &&
  deployer.includes("Destructive Base migration requires"),
  "Base lifecycle invariant failed: forward migration integrity guards are missing."
);
assert(
  explicitRoute.includes('install:"deploy"') &&
  explicitRoute.includes('update:"base_update"') &&
  explicitRoute.includes('redeploy:"redeploy"') &&
  explicitRoute.includes('rollback:"rollback"'),
  "Base lifecycle invariant failed: explicit Base operation routes are incomplete."
);
assert(
  explicitRoute.includes("baseIdempotencyKey(req,body,true)"),
  "Base lifecycle invariant failed: explicit Base mutations must require an idempotency key."
);
assert(
  explicitRoute.includes('pendingBaseForceReinstall(install)') &&
  explicitRoute.includes('completePendingBaseForceReinstall(install)'),
  "Base lifecycle invariant failed: explicit install route must preserve pending force-reinstall completion."
);
assert(
  operations.includes("IDEMPOTENCY_KEY_REUSE") &&
  operations.includes("OPERATION_IN_PROGRESS") &&
  operations.includes("orbitfs_deployment_operations"),
  "Base lifecycle invariant failed: idempotent operation locking contract is missing."
);
assert(
  migration.includes("unique (installation_id,idempotency_key)") &&
  migration.includes("orbitfs_one_active_deployment_operation"),
  "Base lifecycle invariant failed: database idempotency constraints are missing."
);
assert(
  status.includes("baseReleaseDiscoveryByChannel") &&
  status.includes('"authority_unavailable"'),
  "Base lifecycle invariant failed: release authority outage must not be reported as current."
);
assert(
  portal.includes('/base/${baseAction}') &&
  portal.includes('headers["Idempotency-Key"]=crypto.randomUUID()'),
  "Base lifecycle invariant failed: Portal Base mutations must use explicit idempotent Base APIs."
);
assert(
  portal.includes('const isBase=action!=="update"') &&
  portal.includes('/api/orbitfs/installations/${install.id}/deploy'),
  "Base lifecycle invariant failed: normal Engine/add-on updates must remain separate from Base lifecycle operations."
);
assert(
  legacyRoute.includes('runBaseLifecycleOperation') &&
  legacyRoute.includes('legacy-${randomUUID()}'),
  "Base lifecycle invariant failed: legacy compatibility route must still be safely ledgered."
);

console.log("Base lifecycle contract checks passed.");
