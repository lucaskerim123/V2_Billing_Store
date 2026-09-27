import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(path,"utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

const deployer=read("src/lib/orbitfs-customer-deployer.ts");
const operations=read("src/lib/orbitfs-base-operations.ts");
const explicitRoute=read("src/app/api/orbitfs/installations/[id]/base/[action]/route.ts");
const status=read("src/app/api/orbitfs/status/route.ts");
const portal=read("src/app/portal/orbitfs/page.tsx");
const migration=read("database/migrations/20260928020000_orbitfs_base_operation_ledger.sql");

const createProjectCalls=(deployer.match(/ensureVercelProject\(/g)||[]).length;
assert(createProjectCalls===1,"Base lifecycle invariant failed: ensureVercelProject must have exactly one call site.");
assert(
  deployer.includes('if(action==="deploy"&&!install.vercel_project_id)install=await ensureVercelProject(install);'),
  "Base lifecycle invariant failed: only first Base install may create a Vercel project."
);
assert(
  deployer.includes('if(action==="base_update")return await runBaseUpdateDeployment'),
  "Base lifecycle invariant failed: Base update must use its dedicated update path."
);
assert(
  deployer.includes('project:projectId') && deployer.includes('BASE_PROJECT_NOT_FOUND'),
  "Base lifecycle invariant failed: Base update must target the recorded project and hard-fail when project identity is missing."
);
assert(
  deployer.includes('orbitfs_schema_migrations') &&
  deployer.includes('Published migrations are immutable') &&
  deployer.includes('Destructive Base migration requires'),
  "Base lifecycle invariant failed: forward migration immutability/destructive guards are missing."
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
  operations.includes("IDEMPOTENCY_KEY_REUSE") &&
  operations.includes("OPERATION_IN_PROGRESS") &&
  operations.includes("orbitfs_deployment_operations"),
  "Base lifecycle invariant failed: idempotent operation locking contract is missing."
);
assert(
  migration.includes("unique (installation_id,idempotency_key)") &&
  migration.includes("orbitfs_one_active_deployment_operation"),
  "Base lifecycle invariant failed: database idempotency/active-operation constraints are missing."
);
assert(
  status.includes("releaseDiscoveryAvailable") &&
  status.includes('baseUpdateStatus=!releaseDiscoveryAvailable?"authority_unavailable"'),
  "Base lifecycle invariant failed: authority outage must not be reported as Base current/up-to-date."
);
assert(
  portal.includes('/base/${baseAction}') &&
  portal.includes('"Idempotency-Key":crypto.randomUUID()'),
  "Base lifecycle invariant failed: Portal Base mutations must use the explicit idempotent Base API."
);
assert(
  portal.includes('const isBase=action!=="update"') &&
  portal.includes('/api/orbitfs/installations/${install.id}/deploy'),
  "Base lifecycle invariant failed: normal Engine/add-on updates must remain separate from Base lifecycle operations."
);

console.log("Base lifecycle contract checks passed.");
