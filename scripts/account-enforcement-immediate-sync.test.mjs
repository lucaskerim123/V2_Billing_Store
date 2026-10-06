import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import ts from "typescript";

const root=new URL("../",import.meta.url);

function loadStateModule(){
  const url=new URL("src/lib/account-enforcement-state.ts",root);
  assert.equal(existsSync(url),true,"account enforcement state module must exist");
  const source=readFileSync(url,"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function("exports","module","require",compiled)(module.exports,module,()=>{throw new Error("account-enforcement-state.ts must stay dependency-free")});
  return module.exports;
}

test("account enforcement maps to canonical License Manager controls",()=>{
  const {normalizeAccountEnforcementState,licenseControlForAccountEnforcement}=loadStateModule();
  assert.equal(normalizeAccountEnforcementState("banned"),"terminated");
  assert.deepEqual(licenseControlForAccountEnforcement("active",""),{action:"activate",queueAction:"unblock",expectedStorageStatus:"active"});
  assert.deepEqual(licenseControlForAccountEnforcement("suspended","Billing hold"),{action:"suspend",scope:"account",reason:"account_enforcement:suspended:Billing hold",queueAction:"block",expectedStorageStatus:"suspended"});
  assert.deepEqual(licenseControlForAccountEnforcement("terminated","Fraud"),{action:"terminate",reason:"account_enforcement:terminated:Fraud",queueAction:"block",expectedStorageStatus:"revoked"});
});

test("legacy terminated account mirrors are treated as reconciled, not downgraded",()=>{
  const {accountEnforcementRemoteSatisfied}=loadStateModule();
  assert.equal(accountEnforcementRemoteSatisfied({desired:"suspended",remote:"revoked",reason:"account_enforcement:banned:fraud"}),true);
  assert.equal(accountEnforcementRemoteSatisfied({desired:"suspended",remote:"revoked",reason:"invoice overdue"}),false);
});

test("admin customer enforcement runs through the server enforcement endpoint",()=>{
  const route=new URL("src/app/api/admin/customers/[id]/enforcement/route.ts",root);
  assert.equal(existsSync(route),true,"admin enforcement API route must exist");
  const source=readFileSync(route,"utf8");
  assert.match(source,/admin_set_account_enforcement_v2/);
  assert.match(source,/syncAccountEnforcementNow/);

  for(const relative of [
    "src/app/admin/customers/[id]/page.tsx",
    "src/app/admin/settings/enforcement/accounts/page.tsx"
  ]){
    const ui=readFileSync(new URL(relative,root),"utf8");
    assert.doesNotMatch(ui,/\.rpc\("admin_set_account_enforcement_v2"/);
    assert.match(ui,/\/api\/admin\/customers\/.*\/enforcement/);
  }
});
