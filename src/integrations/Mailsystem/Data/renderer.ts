export type TemplateInput={subject:string;text?:string|null;html?:string|null};
const valueAt=(c:Record<string,unknown>,p:string)=>p.split(".").reduce<unknown>((v,k)=>v&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,c);
export function renderVariable(s:string,c:Record<string,unknown>){return String(s??"").replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,(_,p:string)=>{const v=valueAt(c,p);return v==null?"":String(v)})}
export function renderTemplate(t:TemplateInput,c:Record<string,unknown>){return{subject:renderVariable(t.subject,c),text:t.text?renderVariable(t.text,c):undefined,html:t.html?renderVariable(t.html,c):undefined}}
export function extractVariables(t:TemplateInput){const a=new Set<string>();for(const s of[t.subject,t.text||"",t.html||""])for(const m of s.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g))a.add(m[1]);return[...a].sort()}
