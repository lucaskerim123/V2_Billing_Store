import {clearOrbitSession} from "@/lib/orbitfs-auth-server";

export async function POST(){
 await clearOrbitSession();
 return Response.json({ok:true});
}
