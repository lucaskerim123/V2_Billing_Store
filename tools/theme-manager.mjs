import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const root=process.cwd();
const themesDir=path.join(root,"src","themes");
const activeDir=path.join(themesDir,"active");
const defaultsFile=path.join(activeDir,"defaults.json");
const [command,arg1,arg2]=process.argv.slice(2);
const canonicalBase={admin:"V3A",customer:"V3C"};

function suffixFor(surface){return surface==="admin"?"A":"C";}

async function readManifest(dir){
  const raw=await fs.readFile(path.join(dir,"manifest.json"),"utf8");
  const m=JSON.parse(raw);
  if(!m.id||!m.surface||!m.entry)throw new Error("Theme manifest requires id, surface and entry");
  if(!["admin","customer"].includes(m.surface))throw new Error("Theme surface must be admin or customer");
  if(!String(m.id).endsWith(suffixFor(m.surface)))throw new Error((m.surface==="admin"?"Admin":"Customer")+" theme IDs must end in "+suffixFor(m.surface));
  if(m.extends&&m.extends===m.id)throw new Error("Theme cannot extend itself");
  return m;
}

async function walk(dir,base=dir){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...await walk(p,base));
    else out.push({full:p,rel:path.relative(base,p)});
  }
  return out;
}

async function installedManifests(){
  const map=new Map();
  for(const entry of await fs.readdir(themesDir,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name==="active")continue;
    try{
      const m=await readManifest(path.join(themesDir,entry.name));
      map.set(m.id,m);
    }catch{}
  }
  return map;
}

function inheritanceDepth(id,map,seen=new Set()){
  if(seen.has(id))throw new Error("Theme inheritance cycle detected at "+id);
  seen.add(id);
  const m=map.get(id);
  if(!m)throw new Error("Theme "+id+" is not installed");
  if(!m.extends)return 0;
  const base=map.get(m.extends);
  if(!base)throw new Error("Theme "+id+" extends missing theme "+m.extends);
  if(base.surface!==m.surface)throw new Error("Theme "+id+" cannot extend a different surface");
  return 1+inheritanceDepth(base.id,map,seen);
}

function descendsFrom(id,baseId,map){
  let current=map.get(id);
  const seen=new Set();
  while(current){
    if(current.id===baseId)return true;
    if(!current.extends)return false;
    if(seen.has(current.id))throw new Error("Theme inheritance cycle detected at "+current.id);
    seen.add(current.id);
    current=map.get(current.extends);
  }
  return false;
}

async function validateTheme(id){
  const map=await installedManifests();
  const m=map.get(id);
  if(!m)throw new Error("Theme "+id+" is not installed");
  inheritanceDepth(id,map);
  await fs.access(path.join(themesDir,id,m.entry));
  return {m,map};
}

async function syncRegistry(surface){
  const map=await installedManifests();
  const baseId=canonicalBase[surface];
  if(!map.has(baseId))throw new Error("Canonical "+surface+" base theme "+baseId+" is missing");

  const themes=[...map.values()]
    .filter(m=>m.surface===surface&&(m.standalone===true||descendsFrom(m.id,baseId,map)))
    .sort((a,b)=>inheritanceDepth(a.id,map)-inheritanceDepth(b.id,map)||a.id.localeCompare(b.id));

  const target=path.join(activeDir,surface==="admin"?"admin.css":"customer.css");
  let suffix="";
  if(surface==="admin"){
    try{
      const current=await fs.readFile(target,"utf8");
      const marker="/* OrbitFS control-plane navigation:";
      const index=current.indexOf(marker);
      if(index>=0)suffix="\n\n"+current.slice(index).trimEnd();
    }catch{}
  }

  await fs.mkdir(activeDir,{recursive:true});
  const imports=themes.map(m=>'@import "../'+m.id+'/'+m.entry+'";').join("\n");
  await fs.writeFile(target,"/* OrbitFS "+surface+" theme bundle. Managed by tools/theme-manager.mjs. */\n"+imports+suffix+"\n");
}

async function writeDefault(surface,id){
  let defaults={admin:"V5A",customer:"V3C"};
  try{defaults=JSON.parse(await fs.readFile(defaultsFile,"utf8"))}catch{}
  defaults[surface]=id;
  await fs.mkdir(activeDir,{recursive:true});
  await fs.writeFile(defaultsFile,JSON.stringify(defaults,null,2)+"\n");
}

async function applyTheme(id){
  const {m}=await validateTheme(id);
  await syncRegistry(m.surface);
  await writeDefault(m.surface,m.id);
  console.log("Applied "+m.id+" as the local "+m.surface+" fallback. Production runtime selection is controlled by the Billing Theme Manager.");
}

async function packTheme(id,outArg){
  const {m}=await validateTheme(id);
  const dir=path.join(themesDir,id);
  const zip=new JSZip();
  for(const f of await walk(dir)){
    zip.file(m.id+"/"+f.rel.replaceAll(path.sep,"/"),await fs.readFile(f.full));
  }
  const out=path.resolve(outArg||path.join(root,"theme-packages",m.id+"-"+(m.version||"1.0.0")+".orbit-theme.zip"));
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}));
  console.log(out);
}

async function installTheme(zipPath,apply=false){
  const zip=await JSZip.loadAsync(await fs.readFile(path.resolve(zipPath)));
  const manifests=Object.keys(zip.files).filter(n=>n.endsWith("/manifest.json"));
  if(manifests.length!==1)throw new Error("Theme package must contain exactly one manifest.json");
  const prefix=manifests[0].slice(0,-"manifest.json".length);
  const manifest=JSON.parse(await zip.file(manifests[0]).async("string"));
  if(!manifest.id||!manifest.surface||!manifest.entry)throw new Error("Invalid theme manifest");
  if(!["admin","customer"].includes(manifest.surface))throw new Error("Invalid theme surface");
  if(!String(manifest.id).endsWith(suffixFor(manifest.surface)))throw new Error((manifest.surface==="admin"?"Admin":"Customer")+" theme IDs must end in "+suffixFor(manifest.surface));
  if(prefix!==manifest.id+"/")throw new Error("Package root must match manifest id");

  const dest=path.join(themesDir,manifest.id);
  await fs.rm(dest,{recursive:true,force:true});
  await fs.mkdir(dest,{recursive:true});

  for(const [name,entry] of Object.entries(zip.files)){
    if(entry.dir||!name.startsWith(prefix))continue;
    const rel=name.slice(prefix.length);
    const full=path.resolve(dest,rel);
    if(full!==dest&&!full.startsWith(dest+path.sep))throw new Error("Unsafe theme path");
    await fs.mkdir(path.dirname(full),{recursive:true});
    await fs.writeFile(full,await entry.async("nodebuffer"));
  }

  await validateTheme(manifest.id);
  await syncRegistry(manifest.surface);
  if(apply)await applyTheme(manifest.id);
  console.log("Installed "+manifest.id+".");
}

async function syncAll(){
  await syncRegistry("admin");
  await syncRegistry("customer");
  console.log("Theme bundles synchronized.");
}

async function validateAll(){
  const map=await installedManifests();
  for(const m of map.values()){
    inheritanceDepth(m.id,map);
    await fs.access(path.join(themesDir,m.id,m.entry));
  }
  console.log("Validated "+map.size+" filesystem theme packages.");
}

try{
  if(command==="pack")await packTheme(arg1,arg2);
  else if(command==="install")await installTheme(arg1,false);
  else if(command==="install-apply")await installTheme(arg1,true);
  else if(command==="apply")await applyTheme(arg1);
  else if(command==="sync")await syncAll();
  else if(command==="validate")await validateAll();
  else throw new Error("Usage: node tools/theme-manager.mjs pack <ThemeId> [output] | install <zip> | install-apply <zip> | apply <ThemeId> | sync | validate");
}catch(error){
  console.error(error.message||error);
  process.exit(1);
}
