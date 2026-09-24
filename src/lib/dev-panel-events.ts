const DEFAULT_URL=String(process.env.DEV_PANEL_URL||"").trim().replace(/\/+$/,"");

function panelUrl(){
 if(!DEFAULT_URL)return "";
 const url=new URL(DEFAULT_URL);
 if(url.protocol!=="https:"||url.search||url.hash)throw new Error("DEV_PANEL_URL must be a clean HTTPS origin");
 const host=url.hostname.toLowerCase();
 if(host==="localhost"||host==="127.0.0.1")throw new Error("DEV_PANEL_URL cannot use a local-only host");
 return url.origin;
}

export async function reportDevPanelReleaseEvent(input:any){
 const base=panelUrl();
 const secret=String(process.env.DEV_PANEL_EVENT_SECRET||"").trim();
 if(!base||!secret)return {ok:false,skipped:true,reason:"Dev Panel event reporting is not configured"};
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetch(base+"/api/release-events",{
   method:"POST",
   headers:{"content-type":"application/json",authorization:"Bearer "+secret},
   body:JSON.stringify(input),
   cache:"no-store",
   signal:controller.signal,
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body?.error||("Dev Panel event endpoint returned HTTP "+response.status));
  return body;
 }finally{clearTimeout(timer)}
}
