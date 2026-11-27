import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BILLING_EMAIL_EVENTS,getBillingEmailEvent} from "../src/lib/billing-email-events.mjs";
import {BUILTIN_INTEGRATIONS,discoverIntegrations} from "../src/lib/integrations/registry.mjs";

test("the Billing Store integration destination contains no installable modules",()=>{
  assert.deepEqual(BUILTIN_INTEGRATIONS,[]);
  assert.deepEqual(discoverIntegrations(),[]);
});

test("Billing email events are hard-coded independently of installed integrations",()=>{
  const keys=BILLING_EMAIL_EVENTS.map(event=>event.key);
  assert.equal(new Set(keys).size,keys.length);
  assert.ok(getBillingEmailEvent("account.password_reset"));
  assert.ok(getBillingEmailEvent("account.email_verification"));
  assert.ok(getBillingEmailEvent("staff.invite"));
  assert.ok(getBillingEmailEvent("invoice.paid"));
  assert.ok(getBillingEmailEvent("invoice.refund"));
  assert.ok(getBillingEmailEvent("cancellation.requested"));
  assert.ok(getBillingEmailEvent("release.update_available"));
  assert.ok(getBillingEmailEvent("deployment.failed"));
  assert.ok(getBillingEmailEvent("news.announcement"));
  assert.ok(getBillingEmailEvent("support.ticket.reopened"));
  assert.equal(getBillingEmailEvent("mail.module.custom_event"),null);
});

test("sensitive event variables are marked without exposing their values",()=>{
  const reset=getBillingEmailEvent("account.password_reset");
  assert.equal(reset.variables.find(variable=>variable.name==="reset_url")?.sensitive,true);
  assert.equal(reset.variables.some(variable=>"value" in variable),false);
});

test("the folder scanner discovers future valid module packages and ignores invalid folders",()=>{
  const root=mkdtempSync(join(tmpdir(),"orbitfs-integrations-"));
  try{
    const valid={format:"orbitfs-billing-integration-v1",id:"example-module",displayName:"Example Module",version:"1.0.0",publisher:"Test Publisher",distribution:"bundled",installable:true,serverOnly:true,requires:["EXAMPLE_API_KEY"],entrypoints:{console:"./console.tsx"},contributions:{adminPages:[{label:"Module settings",route:"/admin/example-module",entrypoint:"console"}],adminMenu:[{label:"Module settings",route:"/admin/example-module",permission:"integrations.view"}]}};
    mkdirSync(join(root,"example-module"));
    writeFileSync(join(root,"example-module","manifest.json"),JSON.stringify(valid));
    writeFileSync(join(root,"example-module","console.tsx"),"export default function Console() { return null; }");
    mkdirSync(join(root,"invalid"));
    writeFileSync(join(root,"invalid","manifest.json"),JSON.stringify({...valid,id:"different-id"}));
    assert.deepEqual(discoverIntegrations(root).map(item=>item.id),["example-module"]);\n    const discovered=discoverIntegrations(root)[0];\n    assert.equal(discovered.contributions.adminPages[0].route,"/admin/example-module");\n    assert.equal(discovered.contributions.adminMenu[0].permission,"integrations.view");
    assert.deepEqual(discoverIntegrations(join(root,"missing")),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
