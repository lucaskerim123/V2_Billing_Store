import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
export const OBS_SCOPES=["customers.read","customers.write","orders.read","orders.write","invoices.read","invoices.write","payments.read","payments.write","licenses.link","billing.override","billing.admin"] as const;
export type ObsScope=typeof OBS_SCOPES[number];
export const obsDb=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||"",process.env.SUPABASE_SERVICE_ROLE_KEY||"",{auth:{persistSession:false,autoRefreshToken:false}});
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
export const createObsToken=()=>"OBS-"+randomBytes(32).toString("base64url");
export async function authorizeObs(req:Request,scope:ObsScope){
 const key=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!/^OBS-[A-Za-z0-9_-]{43}$/.test(key))return null;
 const {data,error}=await obsDb().from("orbitfs_billing_api_keys").select("id,name,scopes,status,key_hash").eq("key_hash",hash(key)).eq("status","active").maybeSingle();
 if(error||!data||!Array.isArray(data.scopes)||!(data.scopes.includes(scope)||data.scopes.includes("billing.admin")))return null;
 const expected=Buffer.from(data.key_hash,"hex"),actual=Buffer.from(hash(key),"hex");
 return expected.length===actual.length&&timingSafeEqual(expected,actual)?{id:data.id,name:data.name}:null;
}
export async function obsAdmin(req:Request){
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!bearer||bearer.startsWith("OBS-"))return null;
 const db=obsDb();const {data:{user},error}=await db.auth.getUser(bearer);
 if(error||!user)return null;
 const {data:access,error:accessError}=await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||"",process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"",{global:{headers:{Authorization:"Bearer "+bearer}},auth:{persistSession:false}}).rpc("get_my_staff_access");
 if(accessError||!access?.permissions?.all)return null;
 return user;
}
export async function storeObsKey(name:string,scopes:ObsScope[],actor:string){
 const key=createObsToken();
 const row={name,key_hash:hash(key),key_last4:key.slice(-4),scopes,status:"active",created_by:actor};
 const {data,error}=await obsDb().from("orbitfs_billing_api_keys").insert(row).select("id,name,key_last4,scopes,status,created_at").single();
 if(error)throw new Error(error.message);
 return {...data,key};
}
