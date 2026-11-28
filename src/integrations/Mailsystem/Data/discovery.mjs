// @ts-check
// Host-neutral discovery: never overwrite existing mappings or guess ambiguous senders.
/** @param {unknown} value */
const normalize = value => String(value ?? "").trim().toLowerCase();
/** @param {unknown} value */
const canonical = value => normalize(value).replace(/[._-]+/g, ".");
/** @type {Partial<Record<string, readonly string[]>>} */
const categories = {
 account:["system","noreply","no-reply"], customers:["system","noreply","no-reply"],
 staff:["system","noreply","no-reply"], licensing:["system","noreply","no-reply"],
 billing:["billing","accounts"], orders:["billing","accounts"],
 support:["support"], services:["technical","system"], deployments:["technical","system"],
 releases:["system","noreply","no-reply"], news:["news","announcements"]
};
/**
 * @typedef {{key: string, name: string, category: string, description?: string, variables: readonly {name: string, sensitive?: boolean}[]}} DiscoveryEvent
 * @typedef {Pick<import("./types").MailTemplate, "template_key" | "display_name" | "subject" | "body_text" | "body_html" | "variables" | "active">} DiscoveryTemplate
 * @typedef {{template_key: string, name?: string | null, subject?: string | null, text_body?: string | null, html?: string | null, from_account?: string | null}} LegacyTemplate
 * @typedef {{event_key: string, template_key?: string | null}} LegacyAutomation
 * @typedef {{events?: readonly DiscoveryEvent[], senders?: readonly {address:string,kind?:string|null}[], triggers?: readonly Pick<import("./types").MailTrigger, "event_key" | "template_key" | "route_key" | "active">[], routes?: readonly Pick<import("./types").MailRoute, "route_key" | "sender_address" | "active">[], templates?: readonly DiscoveryTemplate[], defaultTemplates?: readonly DiscoveryTemplate[], legacyTemplates?: readonly LegacyTemplate[], legacyAutomations?: readonly LegacyAutomation[]}} DiscoveryInput
 * @typedef {DiscoveryEvent & {template: DiscoveryTemplate | null, sender: string | null, existing: boolean, active: boolean, routeKey: string | null, templateKey: string, status: "configured" | "needs_sender" | "needs_template" | "ready_to_configure"}} DiscoveryResult
 * @param {DiscoveryInput} input
 * @returns {DiscoveryResult[]}
 */
export function planMailDiscovery({events=[],senders=[],triggers=[],routes=[],templates=[],defaultTemplates=[],legacyTemplates=[],legacyAutomations=[]}){
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
  }:defaultTemplates.find(t=>t.template_key===(existing?.template_key??event.key))??null);
  const automatic=new Set(senders.filter(s=>!s.kind||s.kind==="system"||s.kind==="department").map(s=>normalize(s.address)));
  const priority=[...(categories[event.category]??[]), "system", "noreply", "no-reply"];
  const candidates=[...automatic].filter(address=>allowed.has(address)&&priority.includes(address.split("@")[0]));
  const specific=candidates.filter(address=>(categories[event.category]??[]).includes(address.split("@")[0]));
  const pool=specific.length?specific:candidates;
  const preferred=normalize(legacy?.from_account);
  const sameDomain=new Set(pool.map(address=>address.split("@")[1])).size===1;
  const ranked=sameDomain?[...pool].sort((a,b)=>priority.indexOf(a.split("@")[0])-priority.indexOf(b.split("@")[0])):[];
  const explicit=!!(existing&&(existing.route_key||existing.active));
  const sender=explicit?(allowed.has(normalize(route?.sender_address))?normalize(route?.sender_address):null):
   automatic.has(preferred)&&allowed.has(preferred)?preferred:pool.length===1?pool[0]:ranked[0]??null;
  return {...event,template,sender,existing:!!existing,active:!!(existing?.active&&route?.active&&template?.active),routeKey:existing?.route_key||null,templateKey:existing?.template_key||event.key,
   status:!sender?"needs_sender":!template?"needs_template":existing&&route?"configured":"ready_to_configure"};
 });
}
