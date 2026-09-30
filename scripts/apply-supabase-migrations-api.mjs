import fs from "node:fs";
import crypto from "node:crypto";

const projectRef=String(process.env.SUPABASE_PROJECT_ID||"").trim();
const token=String(process.env.SUPABASE_ACCESS_TOKEN||"").trim();
const reportPath=process.argv[2]||".orbitfs-supabase/report.json";

if(!projectRef)throw new Error("SUPABASE_PROJECT_ID is required");
if(!token)throw new Error("SUPABASE_ACCESS_TOKEN is required");
if(!fs.existsSync(reportPath))throw new Error("Migration report not found: "+reportPath);

const report=JSON.parse(fs.readFileSync(reportPath,"utf8"));
const pending=Array.isArray(report.pending)?report.pending:[];
const api=`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`;

async function request(url,init={}){
  const response=await fetch(url,{
    ...init,
    headers:{
      authorization:`Bearer ${token}`,
      accept:"application/json",
      ...(init.body?{"content-type":"application/json"}:{}),
      ...(init.headers||{})
    }
  });
  const text=await response.text();
  let body=null;
  try{body=text?JSON.parse(text):null}catch{body=text}
  if(!response.ok){
    throw new Error(`Supabase Management API ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  }
  return body;
}

const live=await request(api);
const liveRows=Array.isArray(live)?live:Array.isArray(live?.migrations)?live.migrations:[];
const liveNames=new Set(liveRows.map(row=>String(row?.name||"").trim()).filter(Boolean));

for(const item of pending){
  const source=String(item.source||"");
  if(!source||!fs.existsSync(source))throw new Error("Pending migration source is missing: "+source);
  const name=source.split("/").pop().replace(/\.sql$/,"").replace(/^\d+_?/,"").replace(/[^A-Za-z0-9_]+/g,"_").replace(/^_+|_+$/g,"").toLowerCase();
  if(!name)throw new Error("Could not derive migration name from "+source);

  // Some migrations were previously applied directly to the confirmed
  // production project with a dated _20260930 suffix. Treat only that exact
  // known equivalent as applied, rather than replaying it under a second name.
  const alreadyApplied=liveNames.has(name)||liveNames.has(name+"_20260930");
  if(alreadyApplied){
    console.log(`Already applied: ${name} (${source})`);
    continue;
  }

  const query=fs.readFileSync(source,"utf8");
  const sha256=crypto.createHash("sha256").update(query).digest("hex");
  console.log(`Applying ${name} · ${sha256.slice(0,12)} · ${source}`);
  await request(api,{
    method:"POST",
    headers:{"Idempotency-Key":`orbitfs-${projectRef}-${sha256}`},
    body:JSON.stringify({name,query})
  });
  liveNames.add(name);
  console.log(`Applied: ${name}`);
}

const after=await request(api);
const afterRows=Array.isArray(after)?after:Array.isArray(after?.migrations)?after.migrations:[];
console.log(JSON.stringify({project_ref:projectRef,applied_migrations:afterRows.length},null,2));
