import {createHash,randomBytes} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {serviceRpc,userFromToken,userRpc} from "@/lib/paymentServer";
import {getPanelRelease} from "@/lib/panel-release";
import {masterExecuteDeployment,masterSyncDeployment} from "@/lib/master-api";

const SUPABASE_API="https://api.supabase.com/v1";
const VERCEL_API="https://api.vercel.com";
const SCHEMA_MAX_BYTES=8*1024*1024;

export type DeployAction="deploy"|"update"|"rollback"|"redeploy";

export function bearer(req:Request){return String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()}
export async function requireOrbitUser(req:Request){const token=bearer(req);if(!token)throw Object.assign(new Error("Authentication required"),{status:401});const user=await userFromToken(token);return {token,user}}
export async function requireOrbitAdmin(req:Request){const auth=await requireOrbitUser(req);const ok=await userRpc(auth.token,"has_permission",{p_permission:"licenses.view"});if(ok!==true)throw Object.assign(new Error("Permission denied"),{status:403});return auth}
export function httpError(error:any){return Response.json({error:error?.message||"Request failed"},{status:Number(error?.status)||500})}

function storeSupabaseRef(){
  try{return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||"").hostname.split(".")[0]||""}catch{return ""}
}
function assertCustomerSupabaseRef(ref:string){
  const storeRef=storeSupabaseRef();
  if(storeRef&&ref===storeRef)throw Object.assign(new Error("The OrbitFS Store database cannot be used as a customer OrbitFS database"),{status:403});
}
function smartRegionCode(value:string){
  const v=String(value||"").trim().toLowerCase();
  if(v==="americas"||v==="emea"||v==="apac")return v;
  if(/^(ap-|asia|au|australia|sg|jp|kr|in|oc|oceania)/.test(v))return "apac";
  if(/^(eu-|europe|uk|gb|me|middle|af|africa)/.test(v))return "emea";
  return "americas";
}

export async function releaseSettings(){
  const {data,error}=await licenseDb().from("orbitfs_release_system_settings").select("*").eq("id","primary").single();
  if(error)throw error;return data;
}
export async function publicReleaseSettings(){const s=await releaseSettings();return {enabled:s.enabled,customer_deploy_enabled:s.customer_deploy_enabled,customer_updates_enabled:s.customer_updates_enabled,customer_rollbacks_enabled:s.customer_rollbacks_enabled,allow_existing_supabase_project:s.allow_existing_supabase_project,allow_create_supabase_project:s.allow_create_supabase_project,supabase_oauth_enabled:s.supabase_oauth_enabled,vercel_oauth_enabled:s.vercel_oauth_enabled,schema_version:s.schema_version,release_channel:s.release_channel}}
export async function requireSystem(capability:"deploy"|"update"|"rollback"="deploy"){
  const s=await releaseSettings();
  if(!s.enabled)throw Object.assign(new Error("OrbitFS Release Panel System is disabled"),{status:503});
  if(capability==="deploy"&&!s.customer_deploy_enabled)throw Object.assign(new Error("Customer deployment is disabled"),{status:503});
  if(capability==="update"&&!s.customer_updates_enabled)throw Object.assign(new Error("Customer updates are disabled"),{status:503});
  if(capability==="rollback"&&!s.customer_rollbacks_enabled)throw Object.assign(new Error("Customer rollback is disabled"),{status:503});
  return s;
}

export async function loadInstallation(id:string,userId:string,allowAdmin=false){
  const db=licenseDb();const {data,error}=await db.from("orbitfs_installations").select("*").eq("id",id).single();
  if(error||!data)throw Object.assign(new Error("OrbitFS installation not found"),{status:404});
  if(data.auth_user_id!==userId&&!allowAdmin)throw Object.assign(new Error("Permission denied"),{status:403});
  return data;
}
export async function event(install:any,type:string,status="info",message="",detail:any={}){await licenseDb().from("orbitfs_deployment_events").insert({installation_id:install.id,auth_user_id:install.auth_user_id,event_type:type,status,message,detail})}

const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export async function createOAuthState(userId:string,provider:"supabase"|"vercel",installationId:string|null,returnPath="/portal/orbitfs"){
  const state=randomBytes(32).toString("hex");
  const {error}=await licenseDb().from("orbitfs_oauth_states").insert({state_hash:hash(state),auth_user_id:userId,installation_id:installationId,provider,return_path:returnPath,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
  if(error)throw error;return state;
}
export async function consumeOAuthState(state:string,provider:"supabase"|"vercel"){
  if(!state)throw Object.assign(new Error("Missing OAuth state"),{status:400});const db=licenseDb();
  const {data,error}=await db.from("orbitfs_oauth_states").select("*").eq("state_hash",hash(state)).eq("provider",provider).single();
  if(error||!data||data.consumed_at||new Date(data.expires_at).getTime()<Date.now())throw Object.assign(new Error("OAuth state is invalid or expired"),{status:400});
  await db.from("orbitfs_oauth_states").update({consumed_at:new Date().toISOString()}).eq("state_hash",data.state_hash);return data;
}

async function releaseSecret(key:string){return serviceRpc("service_orbitfs_release_secret",{p_key:key}) as Promise<string|null>}
async function providerSecret(userId:string,provider:string,key:"access_token"|"refresh_token"){return serviceRpc("service_orbitfs_provider_secret",{p_user_id:userId,p_provider:provider,p_key:key}) as Promise<string|null>}
async function installationSecret(id:string,key:"db_secret"|"db_password"){return serviceRpc("service_orbitfs_installation_secret",{p_installation_id:id,p_key:key}) as Promise<string|null>}
async function storeInstallationSecret(id:string,key:"db_secret"|"db_password",value:string){await serviceRpc("service_store_orbitfs_installation_secret",{p_installation_id:id,p_key:key,p_value:value})}

export async function saveProviderConnection(userId:string,provider:"supabase"|"vercel",tokens:any,metadata:any={}){
  const expiry=tokens.expires_in?new Date(Date.now()+Number(tokens.expires_in)*1000).toISOString():tokens.expires_at||null;
  return serviceRpc("service_upsert_orbitfs_provider_connection",{p_user_id:userId,p_provider:provider,p_access_token:String(tokens.access_token||""),p_refresh_token:String(tokens.refresh_token||""),p_expires_at:expiry,p_metadata:metadata});
}
async function connection(userId:string,provider:string){const {data}=await licenseDb().from("orbitfs_provider_connections").select("*").eq("auth_user_id",userId).eq("provider",provider).maybeSingle();return data}

async function supabaseAccessToken(userId:string){
  const conn=await connection(userId,"supabase");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Supabase account is not connected"),{status:409});
  let token=await providerSecret(userId,"supabase","access_token");if(!token)throw Object.assign(new Error("Supabase connection token is missing"),{status:409});
  if(conn.token_expires_at&&new Date(conn.token_expires_at).getTime()<Date.now()+60000){
    const refresh=await providerSecret(userId,"supabase","refresh_token"),s=await releaseSettings(),secret=await releaseSecret("supabase_client_secret");
    if(!refresh||!s.supabase_client_id||!secret)throw Object.assign(new Error("Supabase connection needs to be reconnected"),{status:409});
    const form=new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh});
    const basic=Buffer.from(`${s.supabase_client_id}:${secret}`).toString("base64");
    const r=await fetch("https://api.supabase.com/v1/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",accept:"application/json",authorization:`Basic ${basic}`},body:form});
    if(!r.ok)throw Object.assign(new Error(`Supabase token refresh failed: ${await r.text()}`),{status:502});
    const j=await r.json();await saveProviderConnection(userId,"supabase",j,conn.metadata||{});token=j.access_token;
  }
  return token;
}
export async function supabaseApi(userId:string,path:string,init:RequestInit={}){
  const token=await supabaseAccessToken(userId);const r=await fetch(`${SUPABASE_API}${path}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})}});
  if(!r.ok)throw Object.assign(new Error(`Supabase API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status});return r.status===204?null:r.json();
}

async function vercelAccessToken(userId:string){const conn=await connection(userId,"vercel");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Vercel account is not connected"),{status:409});const token=await providerSecret(userId,"vercel","access_token");if(!token)throw Object.assign(new Error("Vercel connection token is missing"),{status:409});return {token,teamId:conn.team_id||conn.metadata?.team_id||null}}
function withTeam(path:string,teamId?:string|null){if(!teamId)return path;const u=new URL(path,VERCEL_API);u.searchParams.set("teamId",teamId);return u.pathname+u.search}
export async function vercelApi(userId:string,path:string,init:RequestInit={}){const {token,teamId}=await vercelAccessToken(userId);const r=await fetch(`${VERCEL_API}${withTeam(path,teamId)}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})}});if(!r.ok)throw Object.assign(new Error(`Vercel API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status});return r.status===204?null:r.json()}

export async function listSupabaseResources(userId:string){
  const [organizations,projects]=await Promise.all([supabaseApi(userId,"/organizations"),supabaseApi(userId,"/projects")]);
  const storeRef=storeSupabaseRef();
  return {organizations:Array.isArray(organizations)?organizations:[],projects:(Array.isArray(projects)?projects:[]).filter((p:any)=>(p.id||p.ref)!==storeRef)};
}
export async function selectSupabaseProject(install:any,ref:string){
  const s=await requireSystem("deploy");if(!s.allow_existing_supabase_project)throw Object.assign(new Error("Existing Supabase projects are disabled by the administrator"),{status:403});
  assertCustomerSupabaseRef(ref);
  const projects=await supabaseApi(install.auth_user_id,"/projects") as any[],p=(projects||[]).find((x:any)=>x.id===ref||x.ref===ref);
  if(!p)throw Object.assign(new Error("Supabase project is not available in the customer's connected account"),{status:404});
  const projectRef=p.id||p.ref;assertCustomerSupabaseRef(projectRef);
  const patch={supabase_project_ref:projectRef,supabase_organization_id:p.organization_id||p.organization?.id||p.organization_slug||null,supabase_project_name:p.name||null,supabase_region:p.region||null,state:"preparing_database",last_error:null};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;await event(data,"supabase.project_selected","ok",`Customer Supabase project ${p.name||ref} selected`);return data;
}
export async function createSupabaseProject(install:any,input:any){
  const s=await requireSystem("deploy");if(!s.allow_create_supabase_project)throw Object.assign(new Error("Creating Supabase projects is disabled by the administrator"),{status:403});
  const org=String(input.organizationSlug||input.organizationId||"").trim(),name=String(input.name||`OrbitFS ${install.installation_id}`).trim();if(!org)throw Object.assign(new Error("Customer Supabase organization is required"),{status:400});
  const password=randomBytes(24).toString("base64url"),region=String(input.region||s.default_supabase_region||"apac"),body={name,organization_slug:org,db_pass:password,region_selection:{type:"smartGroup",code:smartRegionCode(region)}};
  const p=await supabaseApi(install.auth_user_id,"/projects",{method:"POST",body:JSON.stringify(body)}),ref=p.id||p.ref;if(!ref)throw new Error("Supabase did not return a project reference");assertCustomerSupabaseRef(ref);await storeInstallationSecret(install.id,"db_password",password);
  const {data,error}=await licenseDb().from("orbitfs_installations").update({supabase_project_ref:ref,supabase_organization_id:org,supabase_project_name:p.name||name,supabase_region:p.region||smartRegionCode(region),state:"preparing_database",last_error:null}).eq("id",install.id).select().single();if(error)throw error;await event(data,"supabase.project_created","ok",`Customer Supabase project ${p.name||name} created`);return data;
}

const CURRENT_SCHEMA_COMPAT=String.raw`
-- ORBITFS_CURRENT_SCHEMA_COMPAT_V1
-- Brings the original fresh Base export up to the current orbitfs-phase1 schema.

CREATE TABLE IF NOT EXISTS public.mcp_active_context_items (
  context_id uuid NOT NULL,
  item_key text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mcp_active_context_items_pkey PRIMARY KEY (context_id, item_key),
  CONSTRAINT mcp_active_context_items_context_id_fkey FOREIGN KEY (context_id)
    REFERENCES public.mcp_active_contexts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.orbitfs_library_meta (
  workspace_id uuid NOT NULL,
  version integer DEFAULT 9 NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT orbitfs_library_meta_pkey PRIMARY KEY (workspace_id)
);

CREATE TABLE IF NOT EXISTS public.orbitfs_library_objects (
  workspace_id uuid NOT NULL,
  bucket text NOT NULL,
  object_id text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT orbitfs_library_objects_pkey PRIMARY KEY (workspace_id, bucket, object_id),
  CONSTRAINT orbitfs_library_objects_bucket_check CHECK (
    bucket = ANY (ARRAY[
      'items'::text,'collections'::text,'groups'::text,'categories'::text,
      'links'::text,'usage'::text,'sections'::text,'events'::text,
      'sourceHistory'::text,'autoLinks'::text,'entities'::text,
      'entityMentions'::text,'facts'::text,'factRelations'::text,
      'records'::text,'changeRequests'::text
    ])
  )
);

ALTER TABLE public.orbitfs_files
  ADD COLUMN IF NOT EXISTS parent_path text
  GENERATED ALWAYS AS (
    CASE
      WHEN POSITION('/' IN path)=0 THEN ''
      ELSE regexp_replace(path, '/[^/]+$', '')
    END
  ) STORED;

GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.orbitfs_server_allowed()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
  select coalesce(
    ((current_setting('request.headers', true))::jsonb ->> 'x-orbitfs-secret') =
      (select value from private.orbitfs_runtime_config where key='server_secret')
    or encode(
      extensions.digest(
        convert_to(coalesce((current_setting('request.headers', true))::jsonb ->> 'x-orbitfs-secret',''),'UTF8'),
        'sha256'
      ),
      'hex'
    ) = (select value from private.orbitfs_runtime_config where key='mcp_server_secret_sha256'),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.mcp_monitoring_snapshot(p_activity_limit integer DEFAULT 100,p_session_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'metrics',jsonb_build_object(
    'clients',(select count(*) from public.mcp_clients),
    'activeClients',(select count(*) from public.mcp_clients where status='active'),
    'activeSessions',(select count(*) from public.mcp_sessions where status='active'),
    'totalRequests',(select coalesce(sum(request_count),0) from public.mcp_sessions),
    'oauthActive',(select count(*) from public.mcp_oauth_tokens where revoked_at is null and expires_at>now()),
    'auditEvents24h',(select count(*) from public.mcp_audit_log where created_at>=now()-interval '24 hours'),
    'lastClientSeenAt',(select max(last_seen_at) from public.mcp_clients),
    'lastSessionSeenAt',(select max(last_seen_at) from public.mcp_sessions)
  ),
  'activity',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select a.id,a.scope_id,a.actor_user_id,a.event_type,a.details,a.created_at,
      coalesce(u.display_name,u.username,a.actor_user_id) as user_name,
      case when a.scope_id='global' then 'Global' else coalesce(w.name,a.scope_id,'Global') end as workspace_name
    from public.mcp_audit_log a
    left join public.orbitfs_users u on u.id::text=a.actor_user_id
    left join public.orbitfs_workspaces w on w.id::text=a.scope_id
    order by a.created_at desc limit greatest(1,least(p_activity_limit,250))
  ) x),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc nulls last) from (
    select s.id,s.client_id,s.user_id,s.username,s.workspace_id,s.provider,s.status,s.request_count,s.connected_at,s.last_seen_at,s.metadata,
      coalesce(u.display_name,u.username,s.username,s.user_id) as user_name,
      coalesce(c.client_name,s.client_id,'ChatGPT') as client_name,
      coalesce(w.name,s.workspace_id,'Not selected') as workspace_name
    from public.mcp_sessions s
    left join public.orbitfs_users u on u.id::text=s.user_id
    left join public.mcp_clients c on c.id=s.client_id
    left join public.orbitfs_workspaces w on w.id::text=s.workspace_id
    order by s.last_seen_at desc nulls last limit greatest(1,least(p_session_limit,100))
  ) x),'[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.mcp_touch_cloud_session(p_user_id text,p_client_id text,p_username text,p_workspace_id text,p_context_key text,p_conversation_id text)
RETURNS TABLE(id uuid,workspace_id text) LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_id uuid;v_workspace text;v_client text;
begin
  select s.id,s.workspace_id into v_id,v_workspace from public.mcp_sessions s
   where s.user_id=p_user_id and s.status='active' and s.metadata@>jsonb_build_object('contextKey',p_context_key)
     and (p_client_id='chatgpt' or s.client_id=p_client_id)
   order by s.last_seen_at desc limit 1;
  if v_id is not null then
    update public.mcp_sessions s set request_count=coalesce(s.request_count,0)+1,last_seen_at=now(),username=p_username,
      metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object('contextKey',p_context_key,'conversationId',p_conversation_id)
      where s.id=v_id;
    id:=v_id;workspace_id:=v_workspace;return next;return;
  end if;
  v_client:=case when p_client_id='chatgpt' then null when exists(select 1 from public.mcp_clients c where c.id=p_client_id) then p_client_id else null end;
  insert into public.mcp_sessions(client_id,user_id,username,workspace_id,provider,status,request_count,metadata)
  values(v_client,p_user_id,p_username,p_workspace_id,'chatgpt','active',1,jsonb_build_object('contextKey',p_context_key,'conversationId',p_conversation_id))
  returning mcp_sessions.id,mcp_sessions.workspace_id into id,workspace_id;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_library_state_get(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_meta public.orbitfs_library_meta%rowtype;v_state jsonb;v_bucket text;v_items jsonb;
begin
  select * into v_meta from public.orbitfs_library_meta where workspace_id=p_workspace_id;
  if not found and not exists(select 1 from public.orbitfs_library_objects where workspace_id=p_workspace_id) then return null;end if;
  v_state=jsonb_build_object('version',coalesce(v_meta.version,9),'workspaceId',p_workspace_id::text,'settings',coalesce(v_meta.settings,'{}'::jsonb),'createdAt',coalesce(v_meta.created_at,now()),'updatedAt',coalesce(v_meta.updated_at,now()));
  foreach v_bucket in array array['items','collections','groups','categories','links','usage','sections','events','sourceHistory','autoLinks','entities','entityMentions','facts','factRelations','records','changeRequests'] loop
    select coalesce(jsonb_agg(payload order by position,object_id),'[]'::jsonb) into v_items from public.orbitfs_library_objects where workspace_id=p_workspace_id and bucket=v_bucket;
    v_state=v_state||jsonb_build_object(v_bucket,coalesce(v_items,'[]'::jsonb));
  end loop;
  return v_state;
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_library_state_patch(p_workspace_id uuid,p_upserts jsonb DEFAULT '[]'::jsonb,p_deletes jsonb DEFAULT '[]'::jsonb,p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_row jsonb;v_bucket text;v_id text;v_position integer;v_payload jsonb;v_updated timestamptz:=now();
begin
  insert into public.orbitfs_library_meta(workspace_id,version,settings,created_at,updated_at)
  values(p_workspace_id,coalesce((p_meta->>'version')::integer,9),coalesce(p_meta->'settings','{}'::jsonb),v_updated,v_updated)
  on conflict(workspace_id) do update set version=coalesce((p_meta->>'version')::integer,public.orbitfs_library_meta.version),settings=coalesce(p_meta->'settings',public.orbitfs_library_meta.settings),updated_at=v_updated;
  for v_row in select value from jsonb_array_elements(case when jsonb_typeof(p_upserts)='array' then p_upserts else '[]'::jsonb end) loop
    v_bucket=coalesce(v_row->>'bucket','');v_id=coalesce(v_row->>'objectId','');if v_bucket='' or v_id='' then continue;end if;
    if v_bucket not in ('items','collections','groups','categories','links','usage','sections','events','sourceHistory','autoLinks','entities','entityMentions','facts','factRelations','records','changeRequests') then raise exception 'Invalid Library bucket: %',v_bucket;end if;
    v_position=coalesce((v_row->>'position')::integer,0);v_payload=coalesce(v_row->'payload','null'::jsonb);
    insert into public.orbitfs_library_objects(workspace_id,bucket,object_id,position,payload,updated_at) values(p_workspace_id,v_bucket,v_id,v_position,v_payload,v_updated)
    on conflict(workspace_id,bucket,object_id) do update set position=excluded.position,payload=excluded.payload,updated_at=excluded.updated_at
      where public.orbitfs_library_objects.position is distinct from excluded.position or public.orbitfs_library_objects.payload is distinct from excluded.payload;
  end loop;
  for v_row in select value from jsonb_array_elements(case when jsonb_typeof(p_deletes)='array' then p_deletes else '[]'::jsonb end) loop
    delete from public.orbitfs_library_objects where workspace_id=p_workspace_id and bucket=v_row->>'bucket' and object_id=v_row->>'objectId';
  end loop;
  return jsonb_build_object('updatedAt',v_updated);
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_context_clear(p_user_id uuid,p_client_id text,p_workspace_id uuid,p_context_key text)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_count integer;begin delete from public.mcp_active_contexts where user_id=p_user_id and client_id=p_client_id and workspace_id=p_workspace_id and context_key=p_context_key;get diagnostics v_count=row_count;return v_count>0;end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_context_get(p_user_id uuid,p_client_id text,p_workspace_id uuid,p_context_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_id uuid;v_header jsonb;v_files jsonb;begin
  select id,receipt into v_id,v_header from public.mcp_active_contexts where user_id=p_user_id and client_id=p_client_id and workspace_id=p_workspace_id and context_key=p_context_key;
  if v_id is null then return null;end if;
  select coalesce(jsonb_agg(payload order by position,item_key),'[]'::jsonb) into v_files from public.mcp_active_context_items where context_id=v_id;
  return coalesce(v_header,'{}'::jsonb)||jsonb_build_object('files',coalesce(v_files,'[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_context_patch(p_user_id uuid,p_client_id text,p_workspace_id uuid,p_context_key text,p_header jsonb DEFAULT '{}'::jsonb,p_upserts jsonb DEFAULT '[]'::jsonb,p_deletes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_id uuid;v_row jsonb;v_key text;v_position integer;v_payload jsonb;begin
  select id into v_id from public.mcp_active_contexts where user_id=p_user_id and client_id=p_client_id and workspace_id=p_workspace_id and context_key=p_context_key;
  if v_id is null then insert into public.mcp_active_contexts(user_id,client_id,workspace_id,context_key,receipt,updated_at) values(p_user_id,p_client_id,p_workspace_id,p_context_key,coalesce(p_header,'{}'::jsonb)-'files',now()) returning id into v_id;
  else update public.mcp_active_contexts set receipt=coalesce(p_header,'{}'::jsonb)-'files',updated_at=now() where id=v_id and receipt is distinct from (coalesce(p_header,'{}'::jsonb)-'files');if not found then update public.mcp_active_contexts set updated_at=now() where id=v_id;end if;end if;
  for v_row in select value from jsonb_array_elements(case when jsonb_typeof(p_upserts)='array' then p_upserts else '[]'::jsonb end) loop
    v_key=coalesce(v_row->>'itemKey','');if v_key='' then continue;end if;v_position=coalesce((v_row->>'position')::integer,0);v_payload=coalesce(v_row->'payload','{}'::jsonb);
    insert into public.mcp_active_context_items(context_id,item_key,position,payload,updated_at) values(v_id,v_key,v_position,v_payload,now())
    on conflict(context_id,item_key) do update set position=excluded.position,payload=excluded.payload,updated_at=excluded.updated_at where public.mcp_active_context_items.position is distinct from excluded.position or public.mcp_active_context_items.payload is distinct from excluded.payload;
  end loop;
  delete from public.mcp_active_context_items where context_id=v_id and item_key in (select value#>>'{}' from jsonb_array_elements(case when jsonb_typeof(p_deletes)='array' then p_deletes else '[]'::jsonb end));
  return jsonb_build_object('id',v_id,'updatedAt',now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_context_ui(p_user_id uuid,p_client_id text,p_workspace_id uuid,p_context_key text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
declare v_id uuid;v_header jsonb;v_files jsonb;begin
  select id,receipt into v_id,v_header from public.mcp_active_contexts where user_id=p_user_id and client_id=p_client_id and workspace_id=p_workspace_id and context_key=p_context_key;
  if v_id is null then return null;end if;
  select coalesce(jsonb_agg((payload-'content'-'data'-'raw'-'body'-'text'-'base64'-'blob'-'bytesData') order by position,item_key),'[]'::jsonb) into v_files from public.mcp_active_context_items where context_id=v_id;
  return coalesce(v_header,'{}'::jsonb)||jsonb_build_object('files',coalesce(v_files,'[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_folder_files(p_workspace_id text,p_base_path text DEFAULT '',p_recursive boolean DEFAULT true,p_max_files integer DEFAULT 100,p_max_depth integer DEFAULT 10)
RETURNS TABLE(path text) LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with candidates as (
  select f.path,case when coalesce(p_base_path,'')='' then f.path else substring(f.path from length(rtrim(p_base_path,'/'))+2) end as relative_path
  from public.orbitfs_files f where f.workspace_id=p_workspace_id::uuid and f.deleted_at is null and f.kind='file' and f.path not like '_trash/%' and (coalesce(p_base_path,'')='' or f.path like (rtrim(p_base_path,'/')||'/%'))
)
select c.path from candidates c where case when p_recursive then greatest(0,array_length(regexp_split_to_array(c.relative_path,'/'),1)-1)<=greatest(0,least(coalesce(p_max_depth,10),50)) else greatest(0,array_length(regexp_split_to_array(c.relative_path,'/'),1)-1)=0 end order by c.path limit greatest(1,least(coalesce(p_max_files,100),1000));
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_search_files(p_workspace_id text,p_query text,p_base_path text DEFAULT '',p_include_content boolean DEFAULT false,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,name text,path text,kind text,mime_type text,size_bytes bigint,updated_at timestamptz,score integer,excerpt text) LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with matched as (
  select f.id,f.name,f.path,f.kind,f.mime_type,f.size_bytes,f.updated_at,
    ((case when position(lower(p_query) in lower(coalesce(f.name,'')))>0 then 5 else 0 end)+(case when position(lower(p_query) in lower(coalesce(f.path,'')))>0 then 3 else 0 end)+(case when p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,'')))>0 then 2 else 0 end))::integer as score,
    case when p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,'')))>0 then substring(coalesce(f.content_text,'') from greatest(1,position(lower(p_query) in lower(coalesce(f.content_text,'')))-120) for 420) else '' end as excerpt
  from public.orbitfs_files f where f.workspace_id=p_workspace_id::uuid and f.deleted_at is null and (coalesce(p_base_path,'')='' or f.path=p_base_path or f.path like (rtrim(p_base_path,'/')||'/%')) and (position(lower(p_query) in lower(coalesce(f.name,'')))>0 or position(lower(p_query) in lower(coalesce(f.path,'')))>0 or (p_include_content and position(lower(p_query) in lower(coalesce(f.content_text,'')))>0))
)
select id,name,path,kind,mime_type,size_bytes,updated_at,score,excerpt from matched order by score desc,path asc limit greatest(1,least(coalesce(p_limit,50),250));
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_mcp_monitoring_snapshot(p_activity_limit integer DEFAULT 100,p_session_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare v_metrics jsonb;v_activity jsonb;v_sessions jsonb;begin
  if not private.orbitfs_server_allowed() then raise exception 'OrbitFS server authorization required' using errcode='42501';end if;
  select jsonb_build_object('clients',(select count(*) from public.mcp_clients),'activeClients',(select count(*) from public.mcp_clients where status='active'),'activeSessions',(select count(*) from public.mcp_sessions where status='active'),'totalRequests',(select coalesce(sum(request_count),0) from public.mcp_sessions),'oauthActive',(select count(*) from public.mcp_oauth_tokens where revoked_at is null and expires_at>now()),'auditEvents24h',(select count(*) from public.mcp_audit_log where created_at>=now()-interval '24 hours'),'lastClientSeenAt',(select max(last_seen_at) from public.mcp_clients),'lastSessionSeenAt',(select max(last_seen_at) from public.mcp_sessions)) into v_metrics;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) into v_activity from (select a.id,a.scope_id,a.actor_user_id,a.event_type,a.details,a.created_at,coalesce(u.display_name,u.username,a.actor_user_id,'OrbitFS user') as user_name,coalesce(c.client_name,a.details->>'clientId','ChatGPT') as client_name,coalesce(w.name,case when a.scope_id='global' then 'Global' else a.scope_id end,'Global') as workspace_name from public.mcp_audit_log a left join public.orbitfs_users u on u.id::text=a.actor_user_id left join public.mcp_clients c on c.id=a.details->>'clientId' left join public.orbitfs_workspaces w on w.id::text=a.scope_id order by a.created_at desc limit greatest(1,least(coalesce(p_activity_limit,100),250))) q;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.last_seen_at desc),'[]'::jsonb) into v_sessions from (select s.id,s.client_id,s.user_id,s.username,s.workspace_id,s.provider,s.status,s.request_count,s.connected_at,s.last_seen_at,s.metadata,coalesce(s.username,u.display_name,u.username,s.user_id,'OrbitFS user') as user_name,coalesce(c.client_name,s.client_id,'ChatGPT') as client_name,coalesce(w.name,s.workspace_id,'Not selected') as workspace_name from public.mcp_sessions s left join public.orbitfs_users u on u.id::text=s.user_id left join public.mcp_clients c on c.id=s.client_id left join public.orbitfs_workspaces w on w.id::text=s.workspace_id order by s.last_seen_at desc limit greatest(1,least(coalesce(p_session_limit,50),100))) q;
  return jsonb_build_object('metrics',v_metrics,'activity',v_activity,'sessions',v_sessions);
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_set_mcp_session_workspace(p_session_id uuid,p_workspace_id text)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin if not private.orbitfs_server_allowed() then raise exception 'OrbitFS server authorization required' using errcode='42501';end if;update public.mcp_sessions set workspace_id=p_workspace_id where id=p_session_id and workspace_id is distinct from p_workspace_id;return found;end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_touch_addon_request(p_addon_id text,p_min_interval_seconds integer DEFAULT 30)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare changed integer;begin update public.orbitfs_addons set runtime=coalesce(runtime,'{}'::jsonb)||jsonb_build_object('lastRequestAt',now()),updated_at=now() where id=p_addon_id and coalesce((runtime->>'lastRequestAt')::timestamptz,'epoch'::timestamptz)<=now()-make_interval(secs=>greatest(1,p_min_interval_seconds));get diagnostics changed=row_count;return changed>0;end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_touch_mcp_session(p_user_id text,p_client_id text,p_username text,p_workspace_id text,p_context_key text,p_conversation_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','extensions'
AS $function$
declare v_id uuid;v_workspace text;v_client_id text;v_now timestamptz:=now();begin
  if not private.orbitfs_server_allowed() then raise exception 'OrbitFS server authorization required' using errcode='42501';end if;
  if coalesce(trim(p_user_id),'')='' or coalesce(trim(p_context_key),'')='' then raise exception 'MCP session identity is required' using errcode='22023';end if;
  v_client_id:=case when coalesce(p_client_id,'chatgpt')='chatgpt' then null else p_client_id end;if v_client_id is not null and not exists(select 1 from public.mcp_clients where id=v_client_id) then v_client_id:=null;end if;
  select s.id,s.workspace_id into v_id,v_workspace from public.mcp_sessions s where s.user_id=p_user_id and s.status='active' and coalesce(s.client_id,'chatgpt')=coalesce(v_client_id,'chatgpt') and s.metadata->>'contextKey'=p_context_key order by s.last_seen_at desc limit 1 for update;
  if v_id is not null then update public.mcp_sessions set request_count=coalesce(request_count,0)+1,last_seen_at=v_now,username=p_username,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('contextKey',p_context_key,'conversationId',p_conversation_id) where id=v_id;return jsonb_build_object('id',v_id,'workspaceId',v_workspace,'created',false);end if;
  begin insert into public.mcp_sessions(client_id,user_id,username,workspace_id,provider,status,request_count,metadata,last_seen_at) values(v_client_id,p_user_id,p_username,p_workspace_id,'chatgpt','active',1,jsonb_build_object('contextKey',p_context_key,'conversationId',p_conversation_id),v_now) returning id,workspace_id into v_id,v_workspace;
  exception when unique_violation then select s.id,s.workspace_id into v_id,v_workspace from public.mcp_sessions s where s.user_id=p_user_id and s.status='active' and coalesce(s.client_id,'chatgpt')=coalesce(v_client_id,'chatgpt') and s.metadata->>'contextKey'=p_context_key order by s.last_seen_at desc limit 1;update public.mcp_sessions set request_count=coalesce(request_count,0)+1,last_seen_at=v_now,username=p_username,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('contextKey',p_context_key,'conversationId',p_conversation_id) where id=v_id;end;
  return jsonb_build_object('id',v_id,'workspaceId',v_workspace,'created',true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_throttle_last_seen_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin if (to_jsonb(new)-'last_seen_at')=(to_jsonb(old)-'last_seen_at') and coalesce(old.last_seen_at,'epoch'::timestamptz)>now()-interval '60 seconds' then return null;end if;return new;end;
$function$;

CREATE OR REPLACE FUNCTION public.orbitfs_throttle_mcp_session_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin if new.workspace_id is not distinct from old.workspace_id and new.status is not distinct from old.status and new.client_id is not distinct from old.client_id and new.user_id is not distinct from old.user_id and coalesce(old.last_seen_at,'epoch'::timestamptz)>now()-interval '30 seconds' then return null;end if;return new;end;
$function$;

DO $trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='orbitfs_throttle_mcp_session_update' AND NOT tgisinternal) THEN CREATE TRIGGER orbitfs_throttle_mcp_session_update BEFORE UPDATE ON public.mcp_sessions FOR EACH ROW EXECUTE FUNCTION public.orbitfs_throttle_mcp_session_update();END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='orbitfs_sessions_throttle_last_seen' AND NOT tgisinternal) THEN CREATE TRIGGER orbitfs_sessions_throttle_last_seen BEFORE UPDATE ON public.orbitfs_sessions FOR EACH ROW EXECUTE FUNCTION public.orbitfs_throttle_last_seen_update();END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='orbitfs_users_throttle_last_seen' AND NOT tgisinternal) THEN CREATE TRIGGER orbitfs_users_throttle_last_seen BEFORE UPDATE ON public.orbitfs_users FOR EACH ROW EXECUTE FUNCTION public.orbitfs_throttle_last_seen_update();END IF;
END
$trigger$;

CREATE INDEX IF NOT EXISTS mcp_active_context_items_context_position_idx ON public.mcp_active_context_items(context_id,"position");
CREATE INDEX IF NOT EXISTS mcp_context_bundle_dependencies_depends_on_idx ON public.mcp_context_bundle_dependencies(depends_on_bundle_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_client_id_idx ON public.mcp_oauth_codes(client_id);
CREATE INDEX IF NOT EXISTS mcp_project_context_bundles_bundle_id_idx ON public.mcp_project_context_bundles(bundle_id);
CREATE INDEX IF NOT EXISTS mcp_project_preset_bundles_bundle_id_idx ON public.mcp_project_preset_bundles(bundle_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_sessions_active_context_key_uidx ON public.mcp_sessions(user_id,COALESCE(client_id,'chatgpt'::text),((metadata->>'contextKey'::text))) WHERE status='active'::text AND COALESCE((metadata->>'contextKey'::text),''::text)<>''::text;
CREATE INDEX IF NOT EXISTS mcp_sessions_client_id_idx ON public.mcp_sessions(client_id);
CREATE INDEX IF NOT EXISTS mcp_sessions_context_lookup_idx ON public.mcp_sessions(user_id,status,last_seen_at DESC) WHERE status='active'::text;
CREATE INDEX IF NOT EXISTS mcp_workspace_preset_bundles_bundle_id_idx ON public.mcp_workspace_preset_bundles(bundle_id);
CREATE INDEX IF NOT EXISTS orbitfs_audit_log_actor_user_id_idx ON public.orbitfs_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS orbitfs_files_created_by_idx ON public.orbitfs_files(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_files_parent_id_idx ON public.orbitfs_files(parent_id);
CREATE INDEX IF NOT EXISTS orbitfs_files_workspace_parent_active_idx ON public.orbitfs_files(workspace_id,parent_path,kind,name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS orbitfs_group_members_user_id_idx ON public.orbitfs_group_members(user_id);
CREATE INDEX IF NOT EXISTS orbitfs_library_approval_queue_decided_by_idx ON public.orbitfs_library_approval_queue(decided_by);
CREATE INDEX IF NOT EXISTS orbitfs_library_approval_queue_item_id_idx ON public.orbitfs_library_approval_queue(item_id);
CREATE INDEX IF NOT EXISTS orbitfs_library_approval_queue_requested_by_idx ON public.orbitfs_library_approval_queue(requested_by);
CREATE INDEX IF NOT EXISTS orbitfs_library_items_created_by_idx ON public.orbitfs_library_items(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_library_objects_workspace_bucket_position_idx ON public.orbitfs_library_objects(workspace_id,bucket,"position");
CREATE INDEX IF NOT EXISTS orbitfs_library_revisions_created_by_idx ON public.orbitfs_library_revisions(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_profiles_created_by_idx ON public.orbitfs_profiles(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_registration_requests_created_user_id_idx ON public.orbitfs_registration_requests(created_user_id);
CREATE INDEX IF NOT EXISTS orbitfs_registration_requests_decided_by_idx ON public.orbitfs_registration_requests(decided_by);
CREATE INDEX IF NOT EXISTS orbitfs_sessions_user_id_idx ON public.orbitfs_sessions(user_id);
CREATE INDEX IF NOT EXISTS orbitfs_shares_created_by_idx ON public.orbitfs_shares(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_shares_file_id_idx ON public.orbitfs_shares(file_id);
CREATE INDEX IF NOT EXISTS orbitfs_shares_workspace_id_idx ON public.orbitfs_shares(workspace_id);
CREATE INDEX IF NOT EXISTS orbitfs_workspace_messages_created_by_idx ON public.orbitfs_workspace_messages(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_workspace_requests_decided_by_id_idx ON public.orbitfs_workspace_requests(decided_by_id);
CREATE INDEX IF NOT EXISTS orbitfs_workspace_requests_requested_by_id_idx ON public.orbitfs_workspace_requests(requested_by_id);
CREATE INDEX IF NOT EXISTS orbitfs_workspace_requests_target_user_id_idx ON public.orbitfs_workspace_requests(target_user_id);
CREATE INDEX IF NOT EXISTS orbitfs_workspaces_created_by_idx ON public.orbitfs_workspaces(created_by);
CREATE INDEX IF NOT EXISTS orbitfs_workspaces_owner_id_idx ON public.orbitfs_workspaces(owner_id);
CREATE INDEX IF NOT EXISTS studio_analysis_findings_record_id_idx ON public.studio_analysis_findings(record_id);
CREATE INDEX IF NOT EXISTS studio_analysis_records_source_id_idx ON public.studio_analysis_records(source_id);
CREATE INDEX IF NOT EXISTS studio_events_document_id_idx ON public.studio_events(document_id);
CREATE INDEX IF NOT EXISTS studio_links_document_id_idx ON public.studio_links(document_id);
CREATE INDEX IF NOT EXISTS studio_sessions_document_id_idx ON public.studio_sessions(document_id);

ALTER TABLE public.mcp_active_context_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_library_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbitfs_library_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_analysis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_analysis_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_analysis_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_analysis_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orbitfs_server_only ON public.mcp_active_context_items;
CREATE POLICY orbitfs_server_only ON public.mcp_active_context_items FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.orbitfs_library_meta;
CREATE POLICY orbitfs_server_only ON public.orbitfs_library_meta FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.orbitfs_library_objects;
CREATE POLICY orbitfs_server_only ON public.orbitfs_library_objects FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_analysis_findings;
CREATE POLICY orbitfs_server_only ON public.studio_analysis_findings FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_analysis_records;
CREATE POLICY orbitfs_server_only ON public.studio_analysis_records FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_analysis_runs;
CREATE POLICY orbitfs_server_only ON public.studio_analysis_runs FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_analysis_sources;
CREATE POLICY orbitfs_server_only ON public.studio_analysis_sources FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_analysis_state;
CREATE POLICY orbitfs_server_only ON public.studio_analysis_state FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());
DROP POLICY IF EXISTS orbitfs_server_only ON public.studio_links;
CREATE POLICY orbitfs_server_only ON public.studio_links FOR ALL TO anon,authenticated USING(private.orbitfs_server_allowed()) WITH CHECK(private.orbitfs_server_allowed());

GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.mcp_active_context_items,public.orbitfs_library_meta,public.orbitfs_library_objects TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.orbitfs_server_allowed() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_monitoring_snapshot(integer,integer) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_touch_cloud_session(text,text,text,text,text,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_library_state_get(uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_library_state_patch(uuid,jsonb,jsonb,jsonb) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_context_clear(uuid,text,uuid,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_context_get(uuid,text,uuid,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_context_patch(uuid,text,uuid,text,jsonb,jsonb,jsonb) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_context_ui(uuid,text,uuid,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_folder_files(text,text,boolean,integer,integer) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_search_files(text,text,text,boolean,integer) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_mcp_monitoring_snapshot(integer,integer) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_set_mcp_session_workspace(uuid,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_touch_addon_request(text,integer) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_touch_mcp_session(text,text,text,text,text,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_throttle_last_seen_update() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orbitfs_throttle_mcp_session_update() TO anon,authenticated,service_role;
`;

function normalizeSchemaSql(input:string){
  let sql=input;
  const literalNewlines=(sql.match(/\\n/g)||[]).length;
  if(literalNewlines>20)sql=sql.replace(/\\n/g,"\n");
  sql=sql.replace(/\$function\$(?=\s*(?:CREATE|ALTER|GRANT|REVOKE|COMMIT|$))/g,"$function$;");
  sql=sql.replace(/^\s*BEGIN\s*;\s*/i,"").replace(/^\s*COMMIT\s*;\s*$/gim,"");

  const constraintRe=/^ALTER TABLE\s+[^;\n]+\s+ADD CONSTRAINT\s+[^;\n]+;\s*$/gim;
  const constraints=sql.match(constraintRe)||[];
  if(constraints.length){
    sql=sql.replace(constraintRe,"");
    const normal=constraints.filter(x=>!x.toUpperCase().includes("FOREIGN KEY")).map(x=>x.trim());
    const foreign=constraints.filter(x=>x.toUpperCase().includes("FOREIGN KEY")).map(x=>x.trim());
    const ordered=[...normal,...foreign].join("\n\n")+"\n\n";
    const indexAt=sql.search(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/im);
    const functionAt=sql.search(/^\s*CREATE\s+OR\s+REPLACE\s+FUNCTION\b/im);
    const at=indexAt>=0?indexAt:functionAt>=0?functionAt:sql.length;
    sql=sql.slice(0,at)+ordered+sql.slice(at);
  }

  const required=[/CREATE TABLE\s+private\.orbitfs_runtime_config/i,/CREATE TABLE\s+public\.orbitfs_users/i,/CREATE TABLE\s+public\.orbitfs_workspaces/i,/CREATE TABLE\s+public\.orbitfs_files/i,/CREATE TABLE\s+public\.mcp_sessions/i];
  if(required.some(r=>!r.test(sql)))throw new Error("OrbitFS schema asset is not a complete Base schema export");
  if((sql.match(/\$function\$/g)||[]).length%2!==0)throw new Error("OrbitFS schema asset has an unmatched $function$ block");
  if(!sql.includes("ORBITFS_CURRENT_SCHEMA_COMPAT_V1"))sql=sql.trim()+"\n\n"+CURRENT_SCHEMA_COMPAT.trim();
  return sql.trim();
}
async function schemaText(){
  const s=await releaseSettings(),db=licenseDb(),d=await db.storage.from(s.schema_bucket).download(s.schema_path);if(d.error||!d.data)throw Object.assign(new Error("Fresh OrbitFS schema has not been uploaded in the Release Panel System"),{status:409});
  if(d.data.size>SCHEMA_MAX_BYTES)throw new Error("OrbitFS schema asset is too large");const sql=normalizeSchemaSql(await d.data.text());if(!/create\s+table|create\s+schema/i.test(sql))throw new Error("OrbitFS schema asset is invalid");return sql;
}
export async function schemaAssetStatus(){const s=await releaseSettings(),d=await licenseDb().storage.from(s.schema_bucket).download(s.schema_path);return {configured:!d.error&&!!d.data,size:d.data?.size||0,bucket:s.schema_bucket,path:s.schema_path,version:s.schema_version}}
export async function uploadSchemaAsset(sql:string){const s=await releaseSettings();if(!sql||Buffer.byteLength(sql)>SCHEMA_MAX_BYTES)throw new Error("Schema asset is empty or too large");const normalized=normalizeSchemaSql(sql);if(Buffer.byteLength(normalized)>SCHEMA_MAX_BYTES)throw new Error("Normalized OrbitFS schema asset is too large");const db=licenseDb(),b=await db.storage.getBucket(s.schema_bucket);if(!b.data){const c=await db.storage.createBucket(s.schema_bucket,{public:false,fileSizeLimit:SCHEMA_MAX_BYTES});if(c.error&&!String(c.error.message).toLowerCase().includes("already"))throw c.error}const u=await db.storage.from(s.schema_bucket).upload(s.schema_path,Buffer.from(normalized),{contentType:"text/plain",upsert:true,cacheControl:"0"});if(u.error)throw u.error;return schemaAssetStatus()}

async function assertSupabaseProjectReady(install:any){
  assertCustomerSupabaseRef(install.supabase_project_ref);
  const health=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/health?services=db`);
  const rows=Array.isArray(health)?health:Array.isArray(health?.services)?health.services:[];
  if(!rows.length)throw Object.assign(new Error("Supabase database health check returned no status. Try again shortly."),{status:409});
  const db=rows.find((x:any)=>String(x?.name||x?.service||"").toLowerCase()==="db")||rows[0];
  if(String(db?.status||"").toUpperCase()!=="ACTIVE_HEALTHY")throw Object.assign(new Error(`Supabase database is still starting (${db?.status||"not ready"}). Try again shortly.`),{status:409});
}
export async function initializeSupabaseDatabase(install:any){
  await requireSystem("deploy");if(!install.supabase_project_ref)throw Object.assign(new Error("Choose a customer Supabase project first"),{status:409});
  await assertSupabaseProjectReady(install);
  const sql=await schemaText();
  await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:null}).eq("id",install.id);
  await event(install,"database.initializing","info","Initializing current OrbitFS schema in customer Supabase project");
  let dbSecret=String(await installationSecret(install.id,"db_secret")||"");
  if(!dbSecret){dbSecret=randomBytes(32).toString("hex");await storeInstallationSecret(install.id,"db_secret",dbSecret)}
  const runtimeSql=`insert into private.orbitfs_runtime_config(key,value,updated_at) values ('server_secret','${dbSecret}',now()),('ORBITFS_DB_SECRET','${dbSecret}',now()) on conflict (key) do update set value=excluded.value,updated_at=now(); insert into storage.buckets(id,name,public,file_size_limit) values ('orbitfs-files','orbitfs-files',false,1073741824) on conflict (id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit;`;
  const installSql=`BEGIN;\n${sql}\n${runtimeSql}\nCOMMIT;`;
  try{
    await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query:installSql})});
  }catch(e:any){
    const message=String(e?.message||"Database initialization failed");
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message}).eq("id",install.id);
    await event(install,"database.failed","error",message);
    throw e;
  }
  const s=await releaseSettings(),{data,error}=await licenseDb().from("orbitfs_installations").update({schema_version:s.schema_version,database_initialized_at:new Date().toISOString(),state:"awaiting_vercel",last_error:null}).eq("id",install.id).select().single();if(error)throw error;await event(data,"database.ready","ok",`Customer database initialized with OrbitFS schema ${s.schema_version}`);return data;
}

async function publishableKey(install:any){
  assertCustomerSupabaseRef(install.supabase_project_ref);
  const keys=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`) as any[];
  let key=(keys||[]).find((x:any)=>x.type==="publishable")||(keys||[]).find((x:any)=>x.name==="anon"||x.type==="anon");
  if(!key)key=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`,{method:"POST",body:JSON.stringify({type:"publishable",name:"default"})});
  const value=key?.api_key||key?.key||key?.value;if(!value)throw new Error("Could not retrieve or create a Supabase publishable key from the customer's project");return value;
}
async function ensureVercelProject(install:any){
  if(install.vercel_project_id)return install;
  const s=await releaseSettings(),{teamId}=await vercelAccessToken(install.auth_user_id),name=`${s.panel_project_prefix}-${install.installation_id.slice(-8)}`.toLowerCase().replace(/[^a-z0-9-]/g,"-");let p:any;
  try{p=await vercelApi(install.auth_user_id,"/v11/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}catch(e:any){if(!String(e.message).includes("404"))throw e;try{p=await vercelApi(install.auth_user_id,"/v10/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}catch(e2:any){if(!String(e2.message).includes("404"))throw e2;p=await vercelApi(install.auth_user_id,"/v9/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}}
  const {data,error}=await licenseDb().from("orbitfs_installations").update({vercel_team_id:teamId||p.accountId||p.teamId||null,vercel_project_id:p.id,vercel_project_name:p.name||name,state:"configuring",last_error:null}).eq("id",install.id).select().single();if(error)throw error;await event(data,"vercel.project_created","ok",`OrbitFS Panel project ${p.name||name} created in customer Vercel account`);return data;
}
async function upsertVercelEnv(install:any,key:string,value:string){
  await vercelApi(install.auth_user_id,`/v10/projects/${encodeURIComponent(install.vercel_project_id)}/env?upsert=true`,{method:"POST",body:JSON.stringify({key,value,type:"encrypted",target:["production","preview","development"]})});
}
export async function configureVercel(install:any,releaseVersion?:string,panelUrl?:string){const key=await publishableKey(install),secret=await installationSecret(install.id,"db_secret"),licenseToken=String(process.env.DEPLOYER_API_TOKEN||"").trim();if(!secret)throw new Error("OrbitFS database secret is missing");if(!licenseToken)throw new Error("License Master deployer token is not configured");const vars:Record<string,string>={SUPABASE_URL:`https://${install.supabase_project_ref}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:key,ORBITFS_DB_SECRET:secret,ORBITFS_PANEL_URL:panelUrl||"https://panel.incendiarynetworks.cc",ORBITFS_LICENSE_API_URL:"https://api.incendiarynetworks.cc",ORBITFS_LICENSE_API_TOKEN:licenseToken,ORBITFS_APP_VERSION:String(releaseVersion||install.release_version||"unknown"),ORBITFS_ENGINE_RELEASE_PROVIDER:"https://api.incendiarynetworks.cc",ORBITFS_ENGINE_RELEASE_TIMEOUT_MS:"30000",ORBITFS_VERCEL_TIMEOUT_MS:"30000",ORBITFS_LICENSE_REFRESH_MINUTES:"30",ORBITFS_LICENSE_TIMEOUT_MS:"8000",ORBITFS_SCHEMA_VERSION:String(install.schema_version||"1"),ORBITFS_RELEASE_CHANNEL:"base",ORBITFS_PANEL_RELEASE_VERSION:String(releaseVersion||install.release_version||"")};for(const [name,value] of Object.entries(vars)){if(value)await upsertVercelEnv(install,name,value)}}
async function uploadVercelFiles(install:any,files:any[]){const {token,teamId}=await vercelAccessToken(install.auth_user_id),out=[];for(const file of files){const bytes=file.encoding==="base64"?Buffer.from(file.data,"base64"):Buffer.from(file.data,"utf8"),sha=createHash("sha1").update(bytes).digest("hex");let r=await fetch(`${VERCEL_API}${withTeam("/v2/files",teamId)}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/octet-stream","content-length":String(bytes.length),"x-vercel-digest":sha},body:new Uint8Array(bytes)});if(!r.ok&&r.status===404)r=await fetch(`${VERCEL_API}${withTeam("/v2/now/files",teamId)}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/octet-stream","content-length":String(bytes.length),"x-now-digest":sha},body:new Uint8Array(bytes)});if(!r.ok&&r.status!==409)throw new Error(`Vercel file upload failed for ${file.file}: ${await r.text()}`);out.push({file:file.file,sha,size:bytes.length})}return out}

function assertReleaseSchemaCompatible(install:any,release:any){
  const installed=String(install.schema_version||""),required=String(release.metadata?.schemaVersion||release.manifest?.schemaVersion||"1");
  if(installed&&required!==installed)throw Object.assign(new Error(`Panel ${release.metadata.version} requires database schema ${required}, but this installation is schema ${installed}. Apply the required database migration before updating.`),{status:409});
}
export async function deployPanel(install:any,action:DeployAction,version?:string){
  if(action==="rollback")await requireSystem("rollback");else if(action==="update")await requireSystem("update");else await requireSystem("deploy");
  if(!install.database_initialized_at||!install.supabase_project_ref)throw Object.assign(new Error("Initialize the customer's OrbitFS database first"),{status:409});
  const target=action==="redeploy"?(install.release_version||"latest"):(version||"latest"),release=await getPanelRelease(target);assertReleaseSchemaCompatible(install,release);
  const vercel=await vercelAccessToken(install.auth_user_id),publishable=await publishableKey(install),dbSecret=await installationSecret(install.id,"db_secret");
  if(!dbSecret)throw Object.assign(new Error("OrbitFS database secret is missing"),{status:409});
  const state=action==="update"||action==="rollback"?"updating":"deploying";
  await licenseDb().from("orbitfs_installations").update({state,last_error:null,latest_available_release:release.metadata.version}).eq("id",install.id);
  const result=await masterExecuteDeployment({installationId:install.id,userRef:install.auth_user_id,bindingId:install.license_binding_id,releaseId:release.metadata.releaseId,action,actorRef:install.auth_user_id,vercelAccessToken:vercel.token,vercelTeamId:vercel.teamId,vercelProjectId:install.vercel_project_id,vercelProjectName:install.vercel_project_name,env:{SUPABASE_URL:`https://${install.supabase_project_ref}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:publishable,ORBITFS_DB_SECRET:dbSecret}});
  const r=result.result||result;const patch={state,release_version:release.metadata.version,release_id:release.metadata.releaseId,release_sha256:release.metadata.sha256,release_source_commit:release.metadata.sourceCommit,vercel_project_id:r.projectId||install.vercel_project_id,vercel_project_name:r.projectName||install.vercel_project_name,vercel_deployment_id:r.deploymentId||null,deployment_url:r.deploymentUrl||null,last_deployment_at:new Date().toISOString(),last_error:null};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;await event(data,`panel.${action}`,"ok",`${action} Panel ${release.metadata.version} submitted by Master deployment service`,r);return data;
}

export async function syncDeployment(install:any){
  if(!install.vercel_deployment_id)return install;
  const vercel=await vercelAccessToken(install.auth_user_id),result=await masterSyncDeployment({vercelAccessToken:vercel.token,vercelTeamId:vercel.teamId,vercelDeploymentId:install.vercel_deployment_id});
  const state=String(result.state||"").toUpperCase();
  if(["ERROR","CANCELED"].includes(state)){const msg=result.error||`Vercel deployment ${state.toLowerCase()}`;await licenseDb().from("orbitfs_installations").update({state:"failed",health_status:"failed",last_error:msg,last_health_at:new Date().toISOString()}).eq("id",install.id);await event(install,"panel.failed","error",msg);return {...install,state:"failed",health_status:"failed",last_error:msg}}
  if(state!=="READY")return install;
  const url=install.production_url||install.deployment_url||result.url||null;let healthy=false;
  if(url){try{const s=await releaseSettings(),r=await fetch(new URL(s.health_path||"/api/health",url),{redirect:"follow",cache:"no-store"});healthy=r.status<500}catch{healthy=false}}
  const patch={state:"ready",health_status:healthy?"healthy":"degraded",last_health_at:new Date().toISOString(),production_url:url,last_error:healthy?null:"Panel deployed but health check did not succeed"},{data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;await event(data,"panel.ready",healthy?"ok":"warning",healthy?"OrbitFS Panel is ready in the customer Vercel account":"Panel deployed; health check is degraded",{url});return data;
}