// Host-neutral discovery: never overwrite existing mappings or guess ambiguous senders.
const normalize = value => String(value ?? "").trim().toLowerCase();
const canonical = value => normalize(value).replace(/[._-]+/g, ".");
const categories = {
 account:["system","noreply","no-reply"], customers:["system","noreply","no-reply"],
 staff:["system","noreply","no-reply"], licensing:["system","noreply","no-reply"],
 billing:["billing","accounts"], orders:["billing","accounts"],
 support:["support"], services:["technical","system"], deployments:["technical","system"],
 releases:["system","noreply","no-reply"], news:["news","announcements"]
};
export function planMailDiscovery({events=[],senders=[],triggers=[],routes=[],templates=[],legacyTemplates=[],legacyAutomations=[]}){
 const allowed=new Set(senders.map(s=>normalize(s.address)).filter(a=>a.includes("@")));
 return events.map(event=>{
  const existing=triggers.find(t=>t.event_key===event.key);
  const route=existing && routes.find(r=>r.route_key===existing.route_key);
  const automation=legacyAutomations.find(a=>canonical(a.event_key)===canonical(event.key));
  const exact=legacyTemplates.filter(t=>automation?.template_key?t.template_key===automation.template_key:canonical(t.template_key)===canonical(event.key));
  const legacy=exact.length===1?exact[0]:null;
  const saved=templates.find(t=>t.template_key===(existing?.template_key??event.key));
  const template=saved??(legacy?.subject && (legacy.text_body||legacy.html)?{
   template_key:event.key,display_name:legacy.name||event.name,subject:legacy.subject,
   body_text:legacy.text_body??null,body_html:legacy.html??null,
   variables:event.variables.map(v=>v.name),active:false
  }:null);
  const candidates=[...allowed].filter(address=>(categories[event.category]??[]).includes(address.split("@")[0]));
  const preferred=normalize(legacy?.from_account);
  const sameDomain=new Set(candidates.map(address=>address.split("@")[1])).size===1;
  const ranked=sameDomain?[...candidates].sort((a,b)=>(categories[event.category]??[]).indexOf(a.split("@")[0])-(categories[event.category]??[]).indexOf(b.split("@")[0])):[];
  const sender=existing?(allowed.has(normalize(route?.sender_address))?normalize(route.sender_address):null):
   allowed.has(preferred)?preferred:candidates.length===1?candidates[0]:ranked[0]??null;
  return {...event,template,sender,existing:!!existing,active:!!(existing?.active&&route?.active&&template?.active),routeKey:existing?.route_key||null,templateKey:existing?.template_key||event.key,
   status:existing?(sender?"configured":"needs_sender"):!sender?"needs_sender":!template?"needs_template":"ready_to_configure"};
 });
}
