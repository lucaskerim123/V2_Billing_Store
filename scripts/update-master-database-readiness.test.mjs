import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const packages=readFileSync(new URL('../src/lib/orbitfs-database-packages.ts',import.meta.url),'utf8');
const deployer=readFileSync(new URL('../src/lib/orbitfs-customer-deployer.ts',import.meta.url),'utf8');
test('release database package references are pinned to Master Database System',()=>{
  assert.match(packages,/sourceRepo:"lucaskerim123\/Master-Database-System"/);
  assert.match(packages,/record\.sourceRepo/);
  assert.match(packages,/payload\.sourceRepo/);
});
test('every selected Engine component has an immutable central database package before execution',()=>{
  assert.match(deployer,/for\(const component of allowedPackages\)/);
  assert.match(deployer,/DATABASE_PACKAGE_REFERENCE_MISSING/);
  assert.match(deployer,/resolveReleaseDatabasePackage\(release,ref\.component\)/);
});
test('Base package and Engine packages are resolved before customer mutations',()=>{
  const update=deployer.slice(deployer.indexOf('if(action==="update"){'),deployer.indexOf('\n  if(action==="deploy"',deployer.indexOf('if(action==="update"){')));
  assert.ok(update.indexOf('releaseBaseMigrationChain(release)')<update.indexOf('await event(install,"update.started"'));
  assert.ok(update.indexOf('resolveUpdateDatabaseMigrations(release,bundle,engineComponents)')<update.indexOf('await event(install,"update.started"'));
  assert.ok(update.indexOf('updaterConnection(install)')<update.indexOf('await event(install,"update.started"'));
});
test('database changes are applied forward-only through customer Supabase after Master package verification',()=>{
  assert.match(deployer,/orbitfs_schema_migrations/);
  assert.match(deployer,/forward-only/);
  assert.match(deployer,/applyCustomerDatabaseMigrations\(install,release,bundle,engineComponents\)/);
});
