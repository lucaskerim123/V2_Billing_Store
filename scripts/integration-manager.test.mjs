import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
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
 const result=planMailDiscovery({events,senders,triggers:[{event_key:"invoice.created",template_key:"custom",route_key:"custom"}],routes:[{route_key:"custom",sender_address:"billing@orbitfs.cc"}],templates:[{template_key:"custom",display_name:"Custom",subject:"Invoice",body_text:"Invoice created",body_html:null,variables:[],active:false}]});
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

test("clean mail setup produces a draft template and a safe route for every registered event",async()=>{
 const {defaultBillingMailTemplates}=await import("../src/integrations/Mailsystem/Data/billing-defaults.mjs");
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const defaults=defaultBillingMailTemplates(BILLING_EMAIL_EVENTS);
 const rows=planMailDiscovery({events:BILLING_EMAIL_EVENTS,defaultTemplates:defaults,senders:[{address:"system@orbitfs.cc",kind:"system"}]});
 assert.equal(rows.length,BILLING_EMAIL_EVENTS.length);
 for(const row of rows){
  assert.ok(row.template?.subject,row.key);
  assert.ok(row.template?.body_text,row.key);
  assert.equal(row.template.active,false);
  assert.equal(row.sender,"system@orbitfs.cc");
  assert.equal(row.status,"ready_to_configure");
  const used=[...row.template.body_text.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)].map(match=>match[1]);
  assert.ok(used.every(key=>row.variables.some(v=>v.name===key)),row.key);
  assert.ok(row.variables.filter(v=>v.sensitive).every(v=>used.includes(v.name)),row.key);
 }
});
test("automatic discovery retains a template even before a mailbox is assigned and repairs an inactive unassigned trigger",async()=>{
 const {defaultBillingMailTemplates}=await import("../src/integrations/Mailsystem/Data/billing-defaults.mjs");
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const events=BILLING_EMAIL_EVENTS.filter(event=>event.key==="invoice.created");
 const defaults=defaultBillingMailTemplates(events);
 const noMailbox=planMailDiscovery({events,defaultTemplates:defaults})[0];
 assert.ok(noMailbox.template);
 assert.equal(noMailbox.status,"needs_sender");
 const repair=planMailDiscovery({events,defaultTemplates:defaults,templates:defaults,triggers:[{event_key:"invoice.created",template_key:"invoice.created",route_key:null,active:false}],senders:[{address:"billing@orbitfs.cc",kind:"department"}]})[0];
 assert.equal(repair.sender,"billing@orbitfs.cc");
 assert.equal(repair.status,"ready_to_configure");
 assert.equal(repair.active,false);
});
test("mail discovery never reroutes an existing explicit sender or uses a personal mailbox automatically",async()=>{
 const {defaultBillingMailTemplates}=await import("../src/integrations/Mailsystem/Data/billing-defaults.mjs");
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const events=BILLING_EMAIL_EVENTS.filter(event=>event.key==="invoice.created");
 const defaults=defaultBillingMailTemplates(events);
 const input={events,defaultTemplates:defaults,templates:defaults,senders:[{address:"system@orbitfs.cc",kind:"system"},{address:"billing@orbitfs.cc",kind:"personal"}]};
 assert.equal(planMailDiscovery(input)[0].sender,"system@orbitfs.cc");
 const existing=planMailDiscovery({...input,triggers:[{event_key:"invoice.created",template_key:"invoice.created",route_key:"manual",active:false}],routes:[{route_key:"manual",sender_address:"old@orbitfs.cc",active:false}]})[0];
 assert.equal(existing.sender,null);
 assert.equal(existing.status,"needs_sender");
});

test("missing saved template is not reported as configured",async()=>{
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const row=planMailDiscovery({events:[{key:"invoice.created",name:"Invoice",category:"billing",variables:[]}],senders:[{address:"billing@orbitfs.cc",kind:"department"}],triggers:[{event_key:"invoice.created",template_key:"custom",route_key:"custom",active:false}],routes:[{route_key:"custom",sender_address:"billing@orbitfs.cc",active:false}]})[0];
 assert.equal(row.status,"needs_template");
});

test("local detection retains saved routing without guessing remote senders",async()=>{
 const {planMailDiscovery}=await import("../src/integrations/Mailsystem/Data/discovery.mjs");
 const events=[{key:"invoice.created",name:"Invoice",category:"billing",variables:[]},{key:"invoice.paid",name:"Paid",category:"billing",variables:[]}];
 const templates=events.map(event=>({template_key:event.key,display_name:event.name,subject:event.name,body_text:"Example",body_html:null,variables:[],active:true}));
 const input={events,templates,triggers:[{event_key:events[0].key,template_key:events[0].key,route_key:"existing",active:true}],routes:[{route_key:"existing",sender_address:"billing@orbitfs.cc",active:true}]};
 const offline=planMailDiscovery({...input,catalogueAvailable:false});
 assert.equal(offline[0].sender,"billing@orbitfs.cc");
 assert.equal(offline[0].active,true);
 assert.equal(offline[0].status,"configured");
 assert.equal(offline[1].sender,null);
 const verified=planMailDiscovery({...input,senders:[],catalogueAvailable:true});
 assert.equal(verified[0].sender,null);
 assert.equal(verified[0].status,"needs_sender");
});

test("Mail Settings initial load is local and does not provision or run directory sync",()=>{
 const page=readFileSync(new URL("../src/integrations/Mailsystem/Pages/mail-settings/page.tsx",import.meta.url),"utf8");
 const start=page.indexOf('useEffect(()=>{let active=true;void run("load"');
 const end=page.indexOf("const syncAll",start);
 assert.ok(start>=0&&end>start);
 const mount=page.slice(start,end);
 assert.match(mount,/await load\(true\)/);
 assert.doesNotMatch(mount,/await discover\(|mail-directory|await load\(\);/);
});

test("event detection is a local operation, separate from provisioning and directory sync",()=>{
 const route=readFileSync(new URL("../src/app/api/admin/integrations/[integrationId]/mail-discovery/route.ts",import.meta.url),"utf8");
 const post=route.slice(route.indexOf("export async function POST"),route.indexOf("function draft"));
 assert.match(post,/const initial=await discover\(req,true\)/);
 assert.doesNotMatch(post,/getMailModuleConfig|fetch\(|provisioning_domains|verifyMailSystemConnection/);
 const page=readFileSync(new URL("../src/integrations/Mailsystem/Pages/mail-settings/page.tsx",import.meta.url),"utf8");
 const sync=page.slice(page.indexOf("const syncAll"),page.indexOf("const saveConfiguration"));
 assert.match(sync,/mail-directory/);
 assert.doesNotMatch(sync,/discover\(|mail-discovery","POST|mail-mailboxes","POST/);
});
