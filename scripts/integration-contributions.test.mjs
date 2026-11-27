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
