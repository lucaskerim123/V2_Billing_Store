import {notFound} from "next/navigation";
import {INTEGRATION_PAGE_RUNTIME} from "@/lib/integrations/generated-runtime";
import {requireIntegrationAdmin,hasIntegrationPermission} from "@/lib/integrations/admin-context";
import {getBuiltinIntegration,canRunIntegration} from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";
export default async function IntegrationContributionPage({params}:{params:Promise<{moduleId:string}>}){
  const {moduleId}=await params;
  const matches=Object.entries(INTEGRATION_PAGE_RUNTIME).filter(([,page])=>page.integrationId===moduleId);
  if(!matches.length)notFound();
  const manifest=getBuiltinIntegration(moduleId);
  if(!manifest)notFound();
  const runtime=matches[0][1];
  let context;
  try{context=await requireIntegrationAdmin(new Request("http://internal",{headers:{authorization:"Bearer "+(await import("next/headers")).headers().then(h=>h.get("authorization")||"")}}),["integrations.view","integrations.manage"])}catch{notFound()}
  if(!hasIntegrationPermission(context.access,runtime.permission))notFound();
  const {data:state,error}=await context.db.from("app_integrations").select("installed,enabled").eq("integration_id",moduleId).maybeSingle();
  if(error||!canRunIntegration(state))notFound();
  const Component=runtime.component;
  return <Component integration={{id:manifest.id,name:manifest.name,version:manifest.version}}/>;
}
