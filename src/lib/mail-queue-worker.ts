/** Legacy queue worker retained only as a safe compatibility boundary. */
export async function drainMailOutbox(){
 return {processed:0,sent:0,failed:0,disabled:true as const};
}
