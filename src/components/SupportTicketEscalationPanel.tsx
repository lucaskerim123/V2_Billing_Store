"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";

const LEVELS=["Support","Senior Support","Admin","Superadmin"];

export default function SupportTicketEscalationPanel(){
  const path=usePathname(),sb=createClient(),{can}=usePermissions();
  const m=path.match(/^\/admin\/support\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i),id=m?.[1]||"";
  const [data,setData]=useState<any>(null),[me,setMe]=useState(""),[status,setStatus]=useState(""),[reason,setReason]=useState(""),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[open,setOpen]=useState(true);

  async function load(){
    if(!id)return;
    const [{data:d,error},{data:{user}},{data:ticketRow}]=await Promise.all([
      sb.rpc("support_ticket_routing_snapshot",{p_ticket_id:id}),
      sb.auth.getUser(),
      sb.from("support_tickets").select("status").eq("id",id).single()
    ]);
    if(error){setData(null);setMsg(error.message);return}
    setData(d);setMe(user?.id||"");setStatus(ticketRow?.status||"");
  }
  useEffect(()=>{if(id)load();else{setData(null);setMsg("")}},[id]);
  if(!id)return null;
  if(!data)return msg?<div className="supportEscalationError">{msg}</div>:null;

  const t=data.ticket||{},current=Number(t.escalation_level||0),rank=Number(data.actor_rank||0),next=Math.min(3,current+1);
  const canUp=(can("support.escalate")||can("support.manage"))&&current<3&&rank>=next;
  const canDown=(can("support.escalation.manage")||can("support.manage"))&&current>0&&rank>=current+1;
  const currentDepartment=(data.departments||[]).find((d:any)=>d.id===t.department_id);
  const assigned=(data.staff||[]).find((x:any)=>x.user_id===t.assigned_to);
  const claimRequired=!!t.claim_required&&!t.assigned_to;
  const targetClaimLabel=current>0?LEVELS[current]:(currentDepartment?.name||"destination department");
  const canClaim=(can("support.claim")||can("support.manage"))&&(!claimRequired||(current>0?rank>=current+1:true));
  const isMine=!!me&&t.assigned_to===me;
  const closed=status==="closed";

  async function update(fields:any,action?:string){
    setBusy(true);
    const {error}=await sb.rpc("admin_update_support_ticket",{p_ticket_id:id,p_subject:null,p_priority:null,p_department_id:fields.department_id??null,p_status:fields.status??null,p_assigned_to:fields.assigned_to??null,p_assignment_action:action??null});
    setBusy(false);setMsg(error?.message||"Ticket updated.");
    if(!error)await load();
  }

  async function escalate(target:number){
    if(!reason.trim())return setMsg("Escalation/de-escalation reason is required.");
    setBusy(true);
    const {error}=await sb.rpc("admin_escalate_support_ticket",{p_ticket_id:id,p_target_level:target,p_reason:reason.trim()});
    setBusy(false);setMsg(error?.message||`Ticket moved to ${LEVELS[target]}.`);
    if(!error){setReason("");await load();}
  }

  async function department(depId:string){
    if(depId===t.department_id)return;
    const dep=(data.departments||[]).find((d:any)=>d.id===depId);
    if(!confirm(`Transfer this ticket to ${dep?.name||"the selected department"}? The current owner will be removed and the destination department must claim the ticket.`))return;
    await update({department_id:depId},"unassign");
  }

  return <section className={"panel supportCommandPanel"+(open?" expanded":" collapsed")}>
    <div className="supportCommandHead">
      <button className="supportCommandToggle" type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
        <div>
          <p className="eyebrow">TICKET CONTROL</p>
          <h2>{currentDepartment?.name||"No department"} · {assigned?.display_name||"Unassigned"}</h2>
          <p className="muted">{LEVELS[current]} routing · {claimRequired?"Claim required":closed?"Closed":status||"Open"}</p>
        </div>
        <span className="supportCommandToggleLabel">{open?"Hide controls":"Show controls"} {open?"↑":"↓"}</span>
      </button>
      <div className="supportCommandHeadBadges">
        <span className={closed?"supportState closed":"supportState open"}>{closed?"Closed":status||"Open"}</span>
        <span className={`supportTier tier-${current}`}>Tier {current+1}/4</span>
      </div>
    </div>

    {!open&&<div className="supportCommandQuick">
      {!t.assigned_to&&canClaim&&<button onClick={()=>update({assigned_to:me},"claim")} disabled={busy||!me}>Claim</button>}
      {can("support.close")&&<button className={closed?"secondary":"danger"} onClick={()=>update({status:closed?"open":"closed"})} disabled={busy}>{closed?"Reopen":"Close"}</button>}
    </div>}
    {open&&<>
    {claimRequired&&<div className="supportEscalationAlert compact"><b>Claim required</b><span>{targetClaimLabel} or a higher authorised support tier must claim this handoff before reassignment.</span></div>}

    <div className="supportCommandGrid">
      <label><span>Transfer to department</span>{(can("support.department")||can("support.manage"))?<select value={t.department_id||""} onChange={e=>department(e.target.value)} disabled={busy}>{(data.departments||[]).map((d:any)=><option value={d.id} key={d.id}>{d.name}</option>)}</select>:<strong>{currentDepartment?.name||"—"}</strong>}</label>
      <label><span>Assign / transfer staff</span>{claimRequired?<strong>Unassigned · awaiting claim</strong>:(can("support.assign")||can("support.transfer")||can("support.manage")?<select value={t.assigned_to||""} onChange={e=>update({assigned_to:e.target.value||null},e.target.value?(t.assigned_to?"transfer":"assign"):"unassign")} disabled={busy}><option value="">Unassigned</option>{(data.staff||[]).map((s:any)=><option value={s.user_id} key={s.user_id}>{s.display_name} · {s.rank_label}</option>)}</select>:<strong>{assigned?.display_name||"Unassigned"}</strong>)}</label>
      <div className="supportCommandMeta"><span>Escalation</span><strong>{current?LEVELS[current]:"None"}</strong><small>{t.escalated_at?new Date(t.escalated_at).toLocaleString():"Not escalated"}</small></div>
      <div className="supportCommandMeta"><span>Current owner</span><strong>{assigned?.display_name||"Unassigned"}</strong><small>{isMine?"Assigned to you":" "}</small></div>
    </div>

    <div className="supportCommandActions">
      {!t.assigned_to&&canClaim&&<button onClick={()=>update({assigned_to:me},"claim")} disabled={busy||!me}>Claim ticket</button>}
      {t.assigned_to&&(can("support.transfer")||can("support.manage"))&&<button className="secondary" onClick={()=>update({assigned_to:null},"unassign")} disabled={busy}>{isMine?"Unclaim ticket":"Unassign ticket"}</button>}
      {can("support.close")&&<button className={closed?"secondary":"danger"} onClick={()=>update({status:closed?"open":"closed"})} disabled={busy}>{closed?"Reopen ticket":"Close ticket"}</button>}
    </div>

    {(canUp||canDown)&&<div className="supportEscalationCompact">
      <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Escalation reason required…"/>
      <div className="inlineActions">
        {canUp&&<button disabled={busy||!reason.trim()} onClick={()=>escalate(next)}>Escalate → {LEVELS[next]}</button>}
        {canDown&&<button className="secondary" disabled={busy||!reason.trim()} onClick={()=>escalate(current-1)}>De-escalate → {LEVELS[current-1]}</button>}
      </div>
    </div>}

    {t.escalation_reason&&<div className="supportEscalationReason"><b>Current reason</b><span>{t.escalation_reason}</span></div>}
    {msg&&<p className="inlineStatus">{msg}</p>}
    </>}
    {!open&&msg&&<p className="inlineStatus supportCommandCollapsedStatus">{msg}</p>}
  </section>;
}
