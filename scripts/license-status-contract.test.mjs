import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function load(){
  const source=readFileSync(new URL('../src/lib/license-status.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('exports','module','require',compiled)(module.exports,module,()=>{throw new Error('license-status.ts must stay dependency-free')});
  return module.exports;
}

const {canonicalLicenseStatus,canonicalAccountStatus,canonicalComponentStatus,isCanonicalLicenseUsable}=load();

test('active means unbound and locked means bound to an active installation',()=>{
  assert.equal(canonicalLicenseStatus({status:'active',activations:[]}),'active');
  assert.equal(canonicalLicenseStatus({status:'active',activations:[{status:'active'}]}),'locked');
});

test('legacy suspended maps by enforcement scope',()=>{
  assert.equal(canonicalLicenseStatus({status:'suspended',suspension_reason:'account_enforcement:suspended:test'}),'suspended');
  assert.equal(canonicalLicenseStatus({status:'suspended',suspension_reason:'invoice overdue'}),'restricted');
  assert.equal(canonicalLicenseStatus({status:'suspended',metadata:{license_enforcement:{scope:'license'}}}),'restricted');
});

test('legacy revoked and banned are presented canonically as terminated',()=>{
  assert.equal(canonicalLicenseStatus({status:'revoked'}),'terminated');
  assert.equal(canonicalAccountStatus({status:'banned'}),'terminated');
});

test('authority canonical status wins over legacy mirrors',()=>{
  assert.equal(canonicalLicenseStatus({canonical_status:'locked',remote_state:'active'}),'locked');
  assert.equal(canonicalLicenseStatus({authoritative_status:'restricted',remote_state:'suspended'}),'restricted');
});

test('components can be restricted independently while Base remains locked',()=>{
  const row={canonical_status:'locked',components:{orbitfs_base:true,orbitfs_mcp:true,orbitfs_apex:false}};
  assert.equal(canonicalComponentStatus(row,'orbitfs_base'),'locked');
  assert.equal(canonicalComponentStatus(row,'orbitfs_mcp'),'locked');
  assert.equal(canonicalComponentStatus(row,'orbitfs_apex'),'restricted');
});

test('only active and locked licences are usable',()=>{
  assert.equal(isCanonicalLicenseUsable('active'),true);
  assert.equal(isCanonicalLicenseUsable('locked'),true);
  assert.equal(isCanonicalLicenseUsable('restricted'),false);
  assert.equal(isCanonicalLicenseUsable('suspended'),false);
  assert.equal(isCanonicalLicenseUsable('terminated'),false);
});
