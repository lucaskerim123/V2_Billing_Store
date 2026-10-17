import {notFound} from "next/navigation";
const sections=new Set(["overview","catalog","review","progress","installed","recovery","history"]);
export default async function UpdateReleaseSectionPage({params}:{params:Promise<{section:string}>}){
  const {section}=await params;
  if(!sections.has(section))notFound();
  return null;
}
