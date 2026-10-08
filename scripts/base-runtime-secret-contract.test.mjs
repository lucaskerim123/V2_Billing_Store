import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync("src/lib/orbitfs-deployment.ts","utf8");

// Base runtime RLS authenticates against private.orbitfs_runtime_secrets
// through the service-only function, not the legacy singleton table.
assert.match(source,/const runtimeSql=`[\s\S]*?select public\.orbitfs_set_runtime_secret\('\$\{safe\(dbSecretSha256\)\}',3600\);/);
assert.match(source,/const dbSecretSha256=createHash\("sha256"\)\.update\(dbSecret\)\.digest\("hex"\)/);
assert.match(source,/await databaseRuntimeSecretProbe\(install,publishable,contract,dbSecret\)/);

// A retry after committed SQL must not reimport the customer schema.
assert.match(source,/to_regclass\('public\.orbitfs_schema_migrations'\) is not null as migration_table_exists/);
assert.match(source,/if\(existingBaseMigration\)\{[\s\S]*?orbitfs_set_runtime_secret[\s\S]*?\}else\{\s*await supabaseApi\(install\.auth_user_id,queryPath,\{method:"POST",body:JSON\.stringify\(\{query:installSql\}\)\}\);/);
assert.match(source,/BASE_DATABASE_SNAPSHOT_CONFLICT/);

// Authorization remains enforced by License Manager before initialization.
assert.match(source,/export async function initializeSupabaseDatabase\(install:any,releaseId\?:string\)\{\s*await requireSystem\("deploy"\)/);
console.log("Base runtime-secret authorization and retry contract checks passed.");
