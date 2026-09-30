/** Variables shared by the premade-message editor and the actual ticket composer. */
export const PREMADE_SUPPORT_VARIABLES=[
 {key:"name",label:"Customer name",description:"Customer display name"},
 {key:"department",label:"Department",description:"Ticket's current support department"},
 {key:"staff",label:"Staff name",description:"Assigned staff member (or Support team)"},
 {key:"ticket_number",label:"Ticket number",description:"Current ticket reference"},
 {key:"subject",label:"Subject",description:"Current ticket subject"},
 {key:"priority",label:"Priority",description:"Current ticket priority"},
 {key:"status",label:"Status",description:"Current ticket status"},
 {key:"order_number",label:"Order number",description:"Associated order number, if available"}
] as const;

export type SupportPremadeVariable=typeof PREMADE_SUPPORT_VARIABLES[number]["key"];
export function renderSupportPremadeMessage(template:string,values:Partial<Record<SupportPremadeVariable,string>>){
 return template.replace(/\{(name|department|staff|ticket_number|subject|priority|status|order_number)\}/g,
  (original,key:string)=>values[key as SupportPremadeVariable]||original);
}
