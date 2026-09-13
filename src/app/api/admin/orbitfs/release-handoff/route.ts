import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){try{await requireOrbitAdmin(req);const u=new URL(req.url);const action=u.searchParams.get("action")||"drafts";const id=u.searchParams.get("id");return Response.json(await masterRequest(`/api/release-handoff?action=${encodeURIComponent(action)}${id?`&id=${encodeURIComponent(id)}`:""}`,{method:"GET"},"billing"));}catch(e){return httpError(e)}}
export async function POST(req:Request){try{await requireOrbitAdmin(req);const u=new URL(req.url);const action=u.searchParams.get("action")||"publish";const id=u.searchParams.get("id");const body=await req.text();return Response.json(await masterRequest(`/api/release-handoff?action=${encodeURIComponent(action)}${id?`&id=${encodeURIComponent(id)}`:""}`,{method:"POST",headers:{"content-type":"application/json"},body},"billing"));}catch(e){return httpError(e)}}
