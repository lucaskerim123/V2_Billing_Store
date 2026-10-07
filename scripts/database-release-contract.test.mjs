import {readFileSync} from "node:fs";

const packages=readFileSync("src/lib/orbitfs-database-packages.ts","utf8");
const deployer=readFileSync("src/lib/orbitfs-customer-deployer.ts","utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

assert(
  packages.includes('["current","superseded"].includes'),
  "Database release contract failed: exact published releases must remain able to read superseded immutable database packages."
);
assert(
  deployer.includes("async function applyUpdateBaseDatabaseMigrations"),
  "Database release contract failed: Base-targeted Update releases need a dedicated Base database migration path."
);
assert(
  deployer.includes('const engineTargets=executionComponents') &&
  deployer.includes('if(!engineTargets.length)return {migrations:[],skippedByEntitlement:[],source:"license-manager-database-packages" as const};'),
  "Database release contract failed: Base-only Updates must not require Shared Engine database packages."
);
assert(
  deployer.includes("baseDatabaseResult=await applyUpdateBaseDatabaseMigrations") &&
  deployer.includes("engineDatabaseResult=await applyCustomerDatabaseMigrations"),
  "Database release contract failed: Update execution must apply Base and Engine database packages through their correct paths."
);

console.log("Billing database release contract checks passed.");
