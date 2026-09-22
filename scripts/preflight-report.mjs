import {mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const dir=".orbitfs-validation";rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
const npm=process.platform==="win32"?"npm.cmd":"npm";const failures=[];
const compact=(output)=>{const lines=String(output||"").split(/\r?\n/).map(x=>x.trimEnd()).filter(Boolean);let i=-1;for(let n=lines.length-1;n>=0;n--){if(/##\[error\]/i.test(lines[n])){i=n;break;}}if(i<0)for(let n=lines.length-1;n>=0;n--){if(/(?:npm ERR!|Error:|error TS\d+|Type error|Build failed|failed with|Expected .+ got)/i.test(lines[n])){i=n;break;}}if(i<0)return lines.slice(-6);return lines.slice(Math.max(0,i-5),i+1).map(x=>x.replace(/^.*?##\[error\]\s*/,"").trim()).filter(Boolean);};
const run=(label,command,args)=>{console.log("\n=== "+label+" ===");const r=spawnSync(command,args,{encoding:"utf8",shell:false});const output=[r.stdout||"",r.stderr||""].join("\n").trim();if(r.status!==0){failures.push({label,exitCode:r.status??1,output:compact(output)});console.error(output);return false;}return true;};
if(!existsSync("package-lock.json"))failures.push({label:"Repository / lockfile",exitCode:1,output:["package-lock.json is missing."]});
if(!existsSync("vercel.json"))failures.push({label:"Vercel configuration",exitCode:1,output:["vercel.json is missing."]});
else{try{const v=JSON.parse(readFileSync("vercel.json","utf8"));if(v?.git?.deploymentEnabled!==false)failures.push({label:"Automatic Vercel deployments",exitCode:1,output:["vercel.json does not disable automatic Git deployments."]});}catch(e){failures.push({label:"Vercel configuration",exitCode:1,output:[String(e)]});}}
run("Clean locked dependency install",npm,["ci"]);
run("Whitespace / patch integrity","git",["diff","--check"]);
run("Lint",npm,["run","lint"]);
run("Typecheck",npm,["run","typecheck"]);
run("Dependency audit",npm,["audit","--audit-level=high"]);
run("Production build",npm,["run","build"]);
if(failures.length){const out=["ORBITFS VALIDATION FAILED","========================","Only the failing error context is retained.","","Failures: "+failures.length,""];for(const f of failures)out.push("## "+f.label,"Exit code: "+f.exitCode,"","ERROR:",...(f.output||["(no error output)"]),"");writeFileSync(dir+"/validation-error.txt",out.join("\n"));console.error("\nValidation failed. Report: "+dir+"/validation-error.txt");process.exit(1);}
rmSync(dir,{recursive:true,force:true});console.log("\n=== Preflight PASSED ===");
