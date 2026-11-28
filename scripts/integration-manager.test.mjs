import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BILLING_EMAIL_EVENTS,getBillingEmailEvent} from "../src/lib/billing-email-events.mjs";
import {BUILTIN_INTEGRATIONS,discoverIntegrations,canRunIntegration} from "../src/lib/integrations/registry.mjs";

test("the built-in registry exactly matches packages discovered from src/integrations",()=>{
  assert.deepEqual(BUILTIN_INTEGRATIONS.map(item=>item.id),discoverIntegrations().map(item=>item.id));
});
test("Billing email events are hard-coded independently of installed integrations",()=>{
  const keys=BILLING_EMAIL_EVENTS.map(event=>event.key);
  assert.equal(new Set(keys).size,keys.length);
  for(const key of ["account.password_reset","account.email_verification","staff.invite","invoice.paid","invoice.refund","cancellation.requested","release.update_available","deployment.failed","news.announcement","support.ticket.reopened"])assert.ok(getBillingEmailEvent(key));
  assert.equal(getBillingEmailEvent("mail.module.custom_event"),null);
});
test("sensitive event variables are marked without exposing their values",()=>{
  const reset=getBillingEmailEvent("account.password_reset");
  assert.equal(reset.variables.find(variable=>variable.name==="reset_url")?.sensitive,true);
  assert.equal(reset.variables.some(variable=>"value" in variable),false);
});
test("folder discovery validates page and menu contributions and ignores invalid folders",()=>{
  const root=mkdtempSync(join(tmpdir(),"orbitfs-integrations-"));
  try{
    const valid={format:"orbitfs-billing-integration-v1",id:"example-module",displayName:"Example Module",version:"1.0.0",publisher:"Test Publisher",distribution:"bundled",installable:true,serverOnly:true,requires:["EXAMPLE_API_KEY"],entrypoints:{console:"./console.tsx"},contributions:{adminPages:[{label:"Module settings",route:"/admin/integrations/example-module",entrypoint:"console",permission:"integrations.view"}],adminMenu:[{label:"Module settings",route:"/admin/integrations/example-module",permission:"integrations.view"}]}};
    mkdirSync(join(root,"example-module"));
    writeFileSync(join(root,"example-module","manifest.json"),JSON.stringify(valid));
    writeFileSync(join(root,"example-module","console.tsx"),"export default function Console() { return null; }");
    mkdirSync(join(root,"invalid"));
    writeFileSync(join(root,"invalid","manifest.json"),JSON.stringify({...valid,id:"different-id"}));
    const found=discoverIntegrations(root);
    assert.deepEqual(found.map(item=>item.id),["example-module"]);
    assert.equal(found[0].contributions.adminPages[0].route,"/admin/integrations/example-module");
    assert.equal(found[0].contributions.adminMenu[0].permission,"integrations.view");
    assert.deepEqual(discoverIntegrations(join(root,"missing")),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("a module only runs when installed and enabled",()=>{
  assert.equal(canRunIntegration({installed:true,enabled:true}),true);
  assert.equal(canRunIntegration({installed:true,enabled:false}),false);
  assert.equal(canRunIntegration({installed:false,enabled:true}),false);
});

test("automatic mail discovery preserves existing mappings and only picks an unambiguous permitted sender",async()=>{
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const events=[{key:"invoice.created",name:"Invoice created",category:"billing",variables:[]},{key:"account.password_reset",name:"Password reset",category:"account",variables:[{name:"reset_url",sensitive:true}]}];
 const senders=[{id:"a",address:"billing@orbitfs.cc"},{id:"b",address:"system@one.example"},{id:"c",address:"system@two.example"}];
 const result=planMailDiscovery({events,senders,triggers:[{event_key:"invoice.created",template_key:"custom",route_key:"custom"}],routes:[{route_key:"custom",sender_address:"billing@orbitfs.cc"}]});
 assert.equal(result[0].status,"configured");
 assert.equal(result[0].sender,"billing@orbitfs.cc");
 assert.equal(result[1].sender,null);
 assert.equal(result[1].status,"needs_sender");
 assert.equal(result[1].variables[0].sensitive,true);
});
test("automatic mail discovery restores matching legacy template and sender without enabling it",async()=>{
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const result=planMailDiscovery({events:[{key:"account.password_reset",name:"Password reset",category:"account",variables:[{name:"reset_url"}]}],senders:[{id:"a",address:"noreply@orbitfs.cc"}],legacyTemplates:[{template_key:"account_password_reset",name:"Reset",subject:"Reset",text_body:"{{reset_url}}",from_account:"noreply@orbitfs.cc"}]});
 assert.equal(result[0].sender,"noreply@orbitfs.cc");
 assert.equal(result[0].template.body_text,"{{reset_url}}");
 assert.equal(result[0].status,"ready_to_configure");
 assert.equal(result[0].template.active,false);
});
test("automatic mail discovery never guesses a template or routes through an unrelated mailbox",async()=>{
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const result=planMailDiscovery({events:[{key:"support.ticket.created",name:"Ticket",category:"support",variables:[]}],senders:[{id:"a",address:"personal@orbitfs.cc"}]});
 assert.equal(result[0].sender,null);
 assert.equal(result[0].template,null);
 assert.equal(result[0].status,"needs_sender");
});
