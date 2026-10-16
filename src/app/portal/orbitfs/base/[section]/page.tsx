import {notFound} from "next/navigation";
import MyOrbitFS,{type BaseManagementSection} from "../BaseManagementClient";

const allowed=new Set(["overview","updates","connections","domain","technical","history","recovery"]);

export default async function BaseManagementPage({params}:{params:Promise<{section:string}>}){
  const {section}=await params;
  if(!allowed.has(section))notFound();
  return <MyOrbitFS section={section as BaseManagementSection}/>;
}
