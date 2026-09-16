import {getOrbitUser} from "@/lib/orbitfs-auth-server";

export async function GET(){
 const user=await getOrbitUser();
 return Response.json({authenticated:!!user,user});
}
