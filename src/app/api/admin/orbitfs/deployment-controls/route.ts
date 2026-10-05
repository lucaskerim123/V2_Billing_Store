import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({
      authority:"license_manager",
      deprecated:true,
      message:"Customer deployment/update/rollback authority is controlled by License Manager API Control. Billing Store no longer owns a separate deployment gate."
    },{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({
      error:"Deployment authority is controlled by License Manager API Control.",
      code:"BILLING_DEPLOYMENT_AUTHORITY_REMOVED",
      authority:"license_manager"
    },{status:409,headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
