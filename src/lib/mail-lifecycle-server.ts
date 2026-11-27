/** Legacy invoice email hook retained as a no-delivery compatibility boundary. */
export async function sendPaidLifecycleForInvoice(_invoiceId:string){
 return {ok:true,skipped:true,reason:"mail_system_retired" as const};
}
