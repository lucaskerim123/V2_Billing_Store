// Only used to verify that a standby deployment has started.
// Source-mode proxy permits this path but blocks every normal API and UI.
export const dynamic='force-dynamic';
export async function GET(){return Response.json({ready:true,service:'billing-standby-check'},{headers:{'cache-control':'no-store'}});}
