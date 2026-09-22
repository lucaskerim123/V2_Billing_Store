export async function GET(){return Response.json({ok:true,service:"v2-billing-store"});}
export async function OPTIONS(){return new Response(null,{status:204});}
