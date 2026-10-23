"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";

const pretty=(s:string)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
const invoiceDue=(i:any)=>Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0));

function ageLabel(value?:string|null){
  if(!value)return "—";
  const ms=Math.max(0,Date.now()-new Date(value).getTime());
  const h=Math.floor(ms/3600000);
  const d=Math.floor(h/24);
  return d>0?`${d}d`:h>0?`${h}h`:`${Math.max(1,Math.floor(ms/60000))}m`;
}

type AttentionItem={
  key:string;
  kind:"invoice"|"ticket"|"order"|"cancel";
  rank:number;
  href:string;
  record:string;
  subject:string;
  customer:string;
  state:string;
  amount:number|null;
  when:string|null;
  urgent:boolean;
};

export default function Admin(){
  const sb=createClient();
  const {can}=usePermissions();
  const [users,setUsers]=useState<any[]>([]);
  const [tickets,setTickets]=useState<any[]>([]);
  const [orders,setOrders]=useState<any[]>([]);
  const [invoices,setInvoices]=useState<any[]>([]);
  const [balances,setBalances]=useState<any[]>([]);
  const [cancellations,setCancellations]=useState<any>({pending_count:0,scheduled_count:0});
  const [me,setMe]=useState<string>();

  async function load(){
    const {data:{user}}=await sb.auth.getUser();
    setMe(user?.id);
    const jobs:any[]=[];
    jobs.push(can("customers.view")?sb.from("user_profiles").select("*").order("created_at",{ascending:false}):Promise.resolve({data:[]}));
    jobs.push(can("support.manage")?sb.from("support_tickets").select("*,support_departments(name)").order("updated_at",{ascending:false}):Promise.resolve({data:[]}));
    jobs.push(can("orders.view")?sb.from("orders").select("*").order("created_at",{ascending:false}).limit(50):Promise.resolve({data:[]}));
    jobs.push(can("invoices.view")?sb.from("invoices").select("*").order("created_at",{ascending:false}).limit(80):Promise.resolve({data:[]}));
    jobs.push(can("customers.view")?sb.from("account_balances").select("*"):Promise.resolve({data:[]}));
    jobs.push(can("customers.cancellations")?sb.rpc("admin_cancellation_queue_snapshot"):Promise.resolve({data:{pending_count:0,scheduled_count:0}}));
    const [u,t,o,i,b,c]=await Promise.all(jobs);
    setUsers(u.data||[]);
    setTickets(t.data||[]);
    setOrders(o.data||[]);
    setInvoices(i.data||[]);
    setBalances(b.data||[]);
    setCancellations(c.data||{pending_count:0,scheduled_count:0});
  }

  useEffect(()=>{void load()},[can]);

  const activeTickets=tickets.filter(t=>!t.archived_at&&t.status!=="closed");
  const newTickets=activeTickets.filter(t=>t.status==="open"&&!t.assigned_to);
  const staffReply=activeTickets.filter(t=>t.status==="staff_reply");
  const customerReply=activeTickets.filter(t=>t.status==="customer_reply");
  const mine=activeTickets.filter(t=>t.assigned_to===me);
  const queue=useMemo(()=>activeTickets.slice().sort((a,b)=>{
    const rank=(x:any)=>x.status==="staff_reply"?0:(!x.assigned_to&&x.status==="open")?1:x.priority==="urgent"?2:x.priority==="high"?3:x.status==="pending"?4:x.status==="on_hold"?5:6;
    return rank(a)-rank(b)||+new Date(b.updated_at)-+new Date(a.updated_at);
  }).slice(0,6),[tickets,me]);

  const unpaidInvoices=invoices.filter(i=>!["paid","void","cancelled","refunded"].includes(i.status)&&invoiceDue(i)>0);
  const outstanding=unpaidInvoices.reduce((a,i)=>a+invoiceDue(i),0);
  const overdue=unpaidInvoices.filter(i=>i.due_at&&new Date(i.due_at).getTime()<Date.now());
  const waitingOrders=orders.filter(o=>["pending_payment","pending_approval"].includes(o.status)||["pending","unfulfilled"].includes(o.fulfillment_status));
  const pendingCancellations=Number(cancellations.pending_count||0);
  const attentionTotal=unpaidInvoices.length+newTickets.length+staffReply.length+waitingOrders.length+pendingCancellations;

  const owner=(id:string)=>users.find(s=>s.id===id)?.display_name||"Unassigned";
  const customerName=(row:any)=>row?.customer_name||row?.customer?.display_name||users.find(u=>u.id===(row?.user_id||row?.customer_id||row?.customer_user_id))?.display_name||"Customer";

  const attentionItems=useMemo<AttentionItem[]>(()=>{
    const items:AttentionItem[]=[];
    unpaidInvoices.forEach(i=>{
      const isOverdue=!!i.due_at&&new Date(i.due_at).getTime()<Date.now();
      items.push({
        key:`invoice-${i.id}`,
        kind:"invoice",
        rank:isOverdue?0:3,
        href:`/admin/invoices/${i.id}`,
        record:i.invoice_number||"Invoice",
        subject:isOverdue?"Payment overdue":"Payment outstanding",
        customer:customerName(i),
        state:isOverdue?"Overdue":pretty(i.status),
        amount:invoiceDue(i),
        when:i.due_at||i.created_at,
        urgent:isOverdue
      });
    });
    activeTickets.filter(t=>t.status==="staff_reply"||(!t.assigned_to&&t.status==="open")||["urgent","high"].includes(t.priority)).forEach(t=>items.push({
      key:`ticket-${t.id}`,
      kind:"ticket",
      rank:t.status==="staff_reply"?1:2,
      href:`/admin/support/${t.id}`,
      record:`#${t.ticket_number}`,
      subject:t.subject||"Support ticket",
      customer:customerName(t),
      state:t.status==="staff_reply"?"Needs staff reply":!t.assigned_to?"Unassigned":pretty(t.priority),
      amount:null,
      when:t.updated_at,
      urgent:t.priority==="urgent"||t.status==="staff_reply"
    }));
    waitingOrders.forEach(o=>items.push({
      key:`order-${o.id}`,
      kind:"order",
      rank:4,
      href:`/admin/orders/${o.id}`,
      record:`#${o.order_number||o.id}`,
      subject:o.status==="pending_payment"?"Payment pending":o.status==="pending_approval"?"Approval required":"Fulfilment waiting",
      customer:customerName(o),
      state:pretty(o.status||o.fulfillment_status),
      amount:Number(o.total_cents||0),
      when:o.created_at,
      urgent:false
    }));
    if(pendingCancellations>0)items.push({
      key:"cancellations",
      kind:"cancel",
      rank:5,
      href:"/admin/customers/cancellations",
      record:`${pendingCancellations} request${pendingCancellations===1?"":"s"}`,
      subject:"Cancellation review",
      customer:"Customer requests",
      state:"Admin decision",
      amount:null,
      when:null,
      urgent:false
    });
    return items.sort((a,b)=>a.rank-b.rank||+(new Date(a.when||0))-(+(new Date(b.when||0)))).slice(0,12);
  },[unpaidInvoices,activeTickets,waitingOrders,pendingCancellations,users]);

  return <main className="adminShell adminHome">
    <header className="adminHomeIntro">
      <div>
        <p className="eyebrow">ADMIN HOME</p>
        <h1>Operations</h1>
        <p className="muted">A single view of work that needs attention across Billing, Support, Orders and customer accounts.</p>
      </div>
      <div className="adminHomeActions">
        {can("invoices.view")&&<Link className="buttonlink" href="/admin/billing/create?mode=invoice_only">+ Invoice</Link>}
        {can("orders.view")&&<Link className="buttonlink secondary" href="/admin/billing/create?mode=order_only">+ Order</Link>}
        {can("support.ticket_create")&&<Link className="buttonlink secondary" href="/admin/support/new">+ Ticket</Link>}
      </div>
    </header>

    <section className="adminHomeOverview" aria-label="Operational snapshot">
      <Link className="adminHomePriorityCard" href="#attention">
        <span>Priority queue</span>
        <strong>{attentionTotal}</strong>
        <p>Items currently waiting for staff action.</p>
        <em>Open workboard →</em>
      </Link>

      <div className="adminHomeSnapshot">
        {can("invoices.view")&&<Link href="/admin/invoices"><small>Outstanding</small><strong>{`$${(outstanding/100).toFixed(2)}`}</strong><span>{unpaidInvoices.length} invoices · {overdue.length} overdue</span></Link>}
        {can("support.manage")&&<Link href="/admin/support"><small>Support waiting</small><strong>{newTickets.length+staffReply.length}</strong><span>{newTickets.length} unassigned · {staffReply.length} need reply</span></Link>}
        {can("orders.view")&&<Link href="/admin/orders"><small>Orders waiting</small><strong>{waitingOrders.length}</strong><span>Payment, approval or fulfilment</span></Link>}
        {can("customers.cancellations")&&<Link href="/admin/customers/cancellations"><small>Cancellations</small><strong>{pendingCancellations}</strong><span>{Number(cancellations.scheduled_count||0)} scheduled</span></Link>}
      </div>
    </section>

    <section className="adminHomeGrid">
      <section className="adminHomeWorkboard" id="attention">
        <div className="adminHomeSectionHead">
          <div><p className="eyebrow">WORKBOARD</p><h2>Needs attention</h2></div>
          <span>{attentionItems.length} shown</span>
        </div>
        <div className="adminHomeWorkHead" aria-hidden="true">
          <span>Type</span><span>Record</span><span>Customer</span><span>Situation</span><span>Value</span><span>Waiting</span>
        </div>
        <div className="adminHomeWorkList">
          {attentionItems.map(item=><Link className={"adminHomeWorkRow "+(item.urgent?"urgent":"")} href={item.href} key={item.key}>
            <span><b className={"adminHomeKind "+item.kind}>{item.kind}</b></span>
            <span><strong>{item.record}</strong><small>{item.subject}</small></span>
            <span>{item.customer}</span>
            <span>{item.state}</span>
            <span>{item.amount==null?"—":`$${(item.amount/100).toFixed(2)}`}</span>
            <span>{ageLabel(item.when)}</span>
          </Link>)}
          {!attentionItems.length&&<div className="adminHomeEmpty">Nothing currently needs attention.</div>}
        </div>
      </section>

      <aside className="adminHomeRail">
        {can("support.manage")&&<section className="adminHomeRailPanel">
          <div className="adminHomeSectionHead">
            <div><p className="eyebrow">SUPPORT</p><h2>Queue</h2></div>
            <Link href="/admin/support">Open →</Link>
          </div>
          <div className="adminHomeRailStats">
            <span><b>{newTickets.length}</b> new</span>
            <span><b>{staffReply.length}</b> reply</span>
            <span><b>{customerReply.length}</b> customer</span>
            <span><b>{mine.length}</b> mine</span>
          </div>
          <div className="adminHomeRailList">
            {queue.map(t=><Link href={`/admin/support/${t.id}`} key={t.id}>
              <span><b>#{t.ticket_number} {t.subject}</b><small>{t.support_departments?.name||"No department"} · {pretty(t.status)}</small></span>
              <em>{owner(t.assigned_to)} · {ageLabel(t.updated_at)}</em>
            </Link>)}
            {!queue.length&&<div className="adminHomeEmpty compact">No active support tickets.</div>}
          </div>
        </section>}

        {can("customers.view")&&<section className="adminHomeRailPanel">
          <div className="adminHomeSectionHead">
            <div><p className="eyebrow">CUSTOMERS</p><h2>Recent</h2></div>
            <Link href="/admin/customers">All →</Link>
          </div>
          <div className="adminHomeRailList">
            {users.slice(0,6).map(u=>{
              const balance=balances.find(x=>x.user_id===u.id);
              return <Link href={`/admin/customers/${u.id}`} key={u.id}>
                <span><b>{u.display_name||u.id}</b><small>{u.company_name||"Personal"} · {pretty(u.status)}</small></span>
                <em>{`$${((balance?.available_cents||0)/100).toFixed(2)} credit`}</em>
              </Link>;
            })}
          </div>
        </section>}
      </aside>
    </section>
  </main>;
}
