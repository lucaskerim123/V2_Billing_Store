import {createClient} from "@/lib/supabase";

export type OrbitFSMasterProjection={
  authority:"orbitfs-license-master-v2";
  sections:{
    licensing:{licenses:any[];products:any[];revision:any};
    releases:{releases:any[];latest:any|null};
    baseDeployment:{installations:any[];deployments:any[]};
  };
  settings:any;
};

/** Browser-safe connector. The browser never receives a Master API token. */
export async function getOrbitFSMasterProjection():Promise<OrbitFSMasterProjection>{
  const sb=createClient();
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw new Error("Authentication required");
  const response=await fetch("/api/orbitfs/status",{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||"License Master projection unavailable");
  return data as OrbitFSMasterProjection;
}
