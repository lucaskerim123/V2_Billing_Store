"use client";
import {useCallback,useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";

type Props={entityType:"customer"|"order"|"invoice"|"support_ticket";entityId:string;title?:string};
export default function AdminNotesPanel({entityType,entityId,title="Notes"}:Props){
 const [sb]=useState(()=>createClient()),{can}=usePermissions();
 const [notes,setNotes]=useState<any[]>([]),[authors,setAuthors]=useState<Record<string,string>>({});
 const [body,setBody]=useState(""),[visibility,setVisibility]=useState("internal"),[msg,setMsg]=useState("");
 const viewKey=`notes.${entityType==="support_ticket"?"support":entityType}.view`;
 const manageKey=`notes.${entityType==="support_ticket"?"support":entityType}.manage`;
 const load=useCallback(async()=>{
  const {data}=await sb.from("staff_notes").select("*").eq("entity_type",entityType).eq("entity_id",entityId).is("deleted_at",null).order("created_at",{ascending:false});
  const rows=data||[];setNotes(rows);
  const ids=[...new Set(rows.map((x:any)=>x.created_by))];
  if(ids.length){const {data:p}=await sb.from("user_profiles").select("id,display_name").in("id",ids);setAuthors(Object.fromEntries((p||[]).map((x:any)=>[x.id,x.display_name||"Staff"])))}
 },[sb,entityType,entityId]);
 useEffect(()=>{if(entityId&&can(viewKey))void load()},[entityId,can,viewKey,load]); async function add(){if(!body.trim())return;setMsg("Saving note…");const {error}=await sb.rpc("admin_add_staff_note",{p_entity_type:entityType,p_entity_id:entityId,p_body:body,p_visibility:visibility});setMsg(error?.message||"Note added.");if(!error){setBody("");setVisibility("internal");load()}}
 async function remove(id:string){if(!confirm("Delete this note? The deletion is audit logged."))return;const {error}=await sb.rpc("admin_delete_staff_note",{p_note_id:id});setMsg(error?.message||"Note deleted.");if(!error)load()}
 async function edit(n:any){const text=prompt("Edit note",n.body);if(text===null||!text.trim())return;let vis=n.visibility;if(can("notes.external")){const customer=confirm("Make this note visible to the customer?\nOK = customer visible · Cancel = internal only");vis=customer?"customer":"internal"}const {error}=await sb.rpc("admin_update_staff_note",{p_note_id:n.id,p_body:text,p_visibility:vis});setMsg(error?.message||"Note updated.");if(!error)load()}
 if(!can(viewKey))return null;
 return <section className="panel notesPanel"><div className="panelTitle"><div><h2>{title}</h2><p className="muted">Chronological staff notes attached directly to this record.</p></div><span className="noteCount">{notes.length}</span></div>
 {can(manageKey)&&<div className="noteComposer"><textarea rows={4} value={body} onChange={e=>setBody(e.target.value)} placeholder="Add a note…"/><div className="noteComposerBar"><div className="visibilityPicker"><button className={visibility==='internal'?'active':''} onClick={()=>setVisibility('internal')}>Internal · staff only</button>{can("notes.external")&&<button className={visibility==='customer'?'active':''} onClick={()=>setVisibility('customer')}>Customer visible</button>}</div><button onClick={add}>Add note</button></div></div>}
 <div className="noteTimeline">{notes.length?notes.map(n=><article className={`noteCard ${n.visibility==='customer'?'external':''}`} key={n.id}><div className="noteMeta"><div><b>{authors[n.created_by]||"Staff"}</b><span>{new Date(n.created_at).toLocaleString()}</span></div><span className={`noteVisibility ${n.visibility}`}>{n.visibility==='customer'?'Customer visible':'Internal'}</span></div><p>{n.body}</p>{n.updated_at!==n.created_at&&<small>Edited {new Date(n.updated_at).toLocaleString()}</small>}{can(manageKey)&&<div className="noteActions"><button className="small secondary" onClick={()=>edit(n)}>Edit</button><button className="small danger" onClick={()=>remove(n.id)}>Delete</button></div>}</article>):<div className="emptyState"><b>No notes yet</b><span>Important context, decisions and follow-ups can live here.</span></div>}</div>{msg&&<p className="inlineStatus">{msg}</p>}</section>
}