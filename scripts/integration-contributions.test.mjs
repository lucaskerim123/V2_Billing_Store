import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {discoverIntegrations} from "../src/lib/integrations/registry.mjs";

test("discovery exposes only validated generic admin page and menu contributions",()=>{
 const root=mkdtempSync(join(tmpdir(),"orbitfs-contrib-"));
 try{
  const manifest={format:"orbitfs-billing-integration-v1",id:"generic-addon",displayName:"Generic Add-on",version:"1.0.0",publisher:"Test",distribution:"bundled",installable:true,serverOnly:true,requires:[],entrypoints:{settings:"./settings.tsx"},contributions:{adminPages:[{label:"Settings",route:"/admin/integrations/generic-addon",entrypoint:"settings",permission:"integrations.view"}],adminMenu:[{label:"Settings",route:"/admin/integrations/generic-addon",permission:"integrations.view"}]}};
  mkdirSync(join(root,"generic-addon"));writeFileSync(join(root,"generic-addon","manifest.json"),JSON.stringify(manifest));writeFileSync(join(root,"generic-addon","settings.tsx"),"export default function Settings(){return null}");
  const result=discoverIntegrations(root);assert.equal(result.length,1);assert.equal(result[0].contributions.adminPages[0].entrypoint,"settings");
  assert.equal(result[0].contributions.adminMenu[0].route,"/admin/integrations/generic-addon");
  writeFileSync(join(root,"generic-addon","manifest.json"),JSON.stringify({...manifest,contributions:{...manifest.contributions,adminMenu:[{label:"Bad",route:"/admin/not-owned",permission:"integrations.view"}]}}));
  assert.equal(discoverIntegrations(root).length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("discovery supports capitalised integration folders and nested entrypoints",()=>{
 const root=mkdtempSync(join(tmpdir(),"orbitfs-capitalised-"));
 try{
  const folder=join(root,"Mailsystem"),pages=join(folder,"Pages","mail-settings");
  mkdirSync(pages,{recursive:true});
  const manifest={format:"orbitfs-billing-integration-v1",id:"mailsystem",displayName:"Mail System",version:"1.0.0",publisher:"OrbitFS",distribution:"bundled",installable:true,serverOnly:true,requires:["MAIL_SYSTEM_URL"],entrypoints:{adminPage:"./Pages/mail-settings/page.tsx"},contributions:{adminPages:[{label:"Mail Settings",route:"/admin/integrations/mailsystem",entrypoint:"adminPage",permission:"integrations.mail.manage"}],adminMenu:[{label:"Mail Settings",route:"/admin/integrations/mailsystem",permission:"integrations.mail.manage",group:"System"}]}};
  writeFileSync(join(folder,"manifest.json"),JSON.stringify(manifest));
  writeFileSync(join(pages,"page.tsx"),"export default function Page(){return null}");
  const result=discoverIntegrations(root);
  assert.equal(result.length,1);
  assert.equal(result[0].id,"mailsystem");
  assert.equal(result[0].entrypoints.adminPage,"./Pages/mail-settings/page.tsx");
  assert.equal(result[0].contributions.adminMenu[0].group,"System");
 }finally{rmSync(root,{recursive:true,force:true});}
});
