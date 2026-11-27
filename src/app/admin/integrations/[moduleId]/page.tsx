import {notFound} from "next/navigation";
import {cookies} from "next/headers";
import {createServerClient} from "@supabase/ssr";
import {INTEGRATION_PAGE_RUNTIME} from "@/lib/integrations/generated-runtime";
import {getBuiltinIntegration,canRunIntegration} from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";
export default async function IntegrationContributionPage({params}:{params:Promise<{moduleId:string}>}){
  const {moduleId}=await params;
  const manifest=getBuiltinIntegration(moduleId);
  const runtime=Object.values(INTEGRATION_PAGE_RUNTIME).find(page=>page.integrationId===moduleId);
  if(!manifest||!runtime)notFound();
  const cookieStore=await cookies();
  const db=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    cookies:{getAll(){return cookieStore.getAll()},setAll(values){try{values.forEach(({name,value,options})=>cookieStore.set(name,value,options))}catch{}}}
  });
  const {data:{user},error:userError}=await db.auth.getUser();
  if(userError||!user)notFound();
  const {data:accessRows,error:accessError}=await db.rpc("get_my_staff_access");
  const access=Array.isArray(accessRows)?accessRows[0]:accessRows;
  const permissions=access?.permissions;
  const canView=access?.all===true||permissions?.all===true||permissions?.["*"]===true||permissions?.["integrations.view"]===true||permissions?.["integrations.manage"]===true||(Array.isArray(permissions)&&(permissions.includes("*")||permissions.includes("integrations.view")||permissions.includes("integrations.manage")));
  if(accessError||!canView)notFound();
  const {data:state,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id",moduleId).maybeSingle();
  if(error||!canRunIntegration(state))notFound();
  const Component=runtime.component;
  return <Component integration={{id:manifest.id,name:manifest.name,version:manifest.version}}/>;
}
