import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {discoverIntegrations} from "../src/lib/integrations/registry.mjs";

test("discovery exposes validated generic admin contribution metadata",()=>{
 const root=mkdtempSync(join(tmpdir(),"orbitfs-contrib-"));
 try{
  const manifest={format:"orbitfs-billing-integration-v1",id:"generic-addon",displayName:"Generic Add-on",version:"1.0.0",publisher:"Test",distribution:"bundled",installable:true,serverOnly:true,requires:[],entrypoints:{settings:"./settings.tsx"},contributions:{adminPages:[{label:"Settings",route:"/admin/addon-settings",entrypoint:"settings"}],adminMenu:[{label:"Settings",route:"/admin/addon-settings",permission:"integrations.view"}]}};
  mkdirSync(join(root,"generic-addon"));writeFileSync(join(root,"generic-addon","manifest.json"),JSON.stringify(manifest));writeFileSync(join(root,"generic-addon","settings.tsx"),"export default function Settings(){return null}");
  const result=discoverIntegrations(root);assert.equal(result.length,1);assert.equal(result[0].contributions.adminPages[0].entrypoint,"settings");
 }finally{rmSync(root,{recursive:true,force:true});}
});
