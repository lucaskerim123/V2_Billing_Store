"use client";
import {useEffect,useState} from "react";
type Row=Record<string,any>;
type Rule={mailbox_id:string;selector_type:string;selector_code:string;capabilities:string[]};
const capabilities=[["mail.read","Read / receive"],["mail.send","Send / reply"],["mail.update","Manage messages"],["mail.delete","Delete"],["mail.manage_members","Manage members"],["mail.manage_settings","Manage settings"]];
export function MailAccessManager({onLoad,onSave,onSync,canManage=false}:{onLoad:()=>Promise<any>;onSave:(body:any)=>Promise<any>;onSync?:()=>Promise<any>;canManage?:boolean}){
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[mailbox,setMailbox]=useState(""),[kind,setKind]=useState("group"),[edits,setEdits]=useState<Record<string,Rule>>({});
 async function load(sync=false){
  setBusy(true);setStatus("");
  try{
   if(sync&&onSync){const result=await onSync();if(result.ok===false)throw new Error("Some directory records did not sync. Review the sync results.");}
   const result=await onLoad();setData(result);setMailbox(old=>result.core?.mailboxes?.some((m:Row)=>m.id===old)?old:result.core?.mailboxes?.[0]?.id||"");
   if(sync)setStatus("Directory and access synchronized.");
  }catch(e){setStatus(e instanceof Error?e.message:"Could not load directory.");}finally{setBusy(false);}
 }
 useEffect(()=>{void load();},[]);
 const directory=data?.directory||{},core=data?.core||{};
 const users:Row[]=directory.users||[],groups:Row[]=directory.groups||[],departments:Row[]=directory.departments||[],boxes:Row[]=core.mailboxes||[];
 const entries:Row[]=kind==="group"?groups:kind==="department"?departments:kind==="user"?users:(core.roles||[]).filter((r:Row)=>r.active).map((r:Row)=>({code:r.external_code,name:r.display_name}));
 const ruleKey=(type:string,code:string,box:string)=>[type,code,box].join(":");
 function current(type:string,code:string):Rule{
  const key=ruleKey(type,code,mailbox);
  if(edits[key])return edits[key];
  const host=(data?.rules||[]).find((r:Rule)=>r.selector_type===type&&r.selector_code===code&&r.mailbox_id===mailbox);
  if(host)return host;
  const remote=(core.mappings||[]).find((r:Row)=>r.active&&r.mailbox_id===mailbox&&r["external_"+type+"_code"]===code&&[r.external_group_code,r.external_department_code,r.external_role_code].filter(Boolean).length===1);
  const profile=(core.accessProfiles||[]).find((p:Row)=>p.id===remote?.access_profile_id);
  const remoteUser=(core.remoteUsers||[]).find((r:Row)=>r.external_user_id===code);
  const direct=(core.mailboxGrants||[]).filter((r:Row)=>type==="user"&&r.remote_user_id===remoteUser?.id&&r.mailbox_id===mailbox&&r.source_type==="direct"&&r.source_id?.startsWith("host-policy:"));
  return {mailbox_id:mailbox,selector_type:type,selector_code:code,capabilities:profile?.capabilities||[...new Set<string>(direct.flatMap((r:Row)=>r.capabilities||[]))]};
 }
 function toggle(code:string,cap:string,on:boolean){
  const r=current(kind,code),next=on?[...new Set([...r.capabilities,cap])]:r.capabilities.filter(c=>c!==cap);
  setEdits(old=>({...old,[ruleKey(kind,code,mailbox)]:{...r,capabilities:next}}));
 }
 async function save(){
  setBusy(true);setStatus("");
  try{const result=await onSave({rules:Object.values(edits)});if(result.ok===false)throw new Error("Rules were not fully synchronized.");setEdits({});await load();setStatus("Access rules saved and synchronized.");}
  catch(e){setStatus(e instanceof Error?e.message:"Could not save rules.");}finally{setBusy(false);}
 }
 return <section className="panel">
  <div className="panelTitle"><h2>Mailbox access and staff directory</h2></div>
  <p className="muted">Configure which staff groups, departments, roles or individual users receive mailbox access. The Mail System enforces these rules within its security limits.</p>
  <p>{users.length} staff · {groups.length} groups · {departments.length} departments · {boxes.length} permitted mailboxes</p>
  <div className="inlineActions">{onSync&&<button type="button" disabled={busy||!canManage} onClick={()=>void load(true)}>Sync now</button>}<button className="secondary" type="button" disabled={busy} onClick={()=>void load()}>Refresh status</button></div>
  <p role="status">{status}</p>
  <div className="two"><label>Mailbox <select value={mailbox} onChange={e=>setMailbox(e.target.value)}><option value="">Select mailbox</option>{boxes.map(b=><option key={b.id} value={b.id}>{b.address} · {b.kind}</option>)}</select></label>
  <label>Assign by <select value={kind} onChange={e=>setKind(e.target.value)}><option value="group">Staff group / rank</option><option value="department">Department</option><option value="role">Role</option><option value="user">Individual staff</option></select></label></div>
  {!mailbox&&!busy&&<p className="muted">No assigned mailboxes. Configure mailboxes and synchronize the directory first.</p>}
  {mailbox&&<div style={{overflowX:"auto"}}><table><thead><tr><th>Directory entry</th>{capabilities.map(([cap,label])=><th key={cap}>{label}</th>)}</tr></thead><tbody>{entries.map(entry=>{const code=String(entry.code||entry.id),rule=current(kind,code);return <tr key={code}><td>{entry.name||entry.display_name||entry.email||code}</td>{capabilities.map(([cap,label])=><td key={cap}><input type="checkbox" aria-label={label+" for "+(entry.name||entry.display_name||code)} checked={rule.capabilities.includes(cap)} disabled={busy||!canManage} onChange={e=>toggle(code,cap,e.target.checked)}/></td>)}</tr>})}</tbody></table></div>}
  <button type="button" disabled={busy||!canManage||!Object.keys(edits).length} onClick={()=>void save()}>Save access and sync ({Object.keys(edits).length} changes)</button>
  <details><summary>Detected staff and synchronization status</summary>{users.map(user=>{const remote=(core.remoteUsers||[]).find((r:Row)=>r.external_user_id===user.id);return <div key={user.id}>{user.display_name} · {remote?.status||"Not synced"} · {user.email}</div>})}</details>
 </section>;
}
