import Link from "next/link";
import AdminSettingsEditor from "@/components/AdminSettingsEditor";

export default function Page(){
 return <div className="adminSupportSettingsHub">
  <div className="adminShell" style={{paddingBottom:0}}>
   <section className="panel">
    <div className="panelTitle"><div><h2>Support departments & workflow</h2><p className="muted">Manage department routing, staff coverage, escalation and automatic ticket messages.</p></div><Link className="buttonlink secondary" href="/admin/support/settings">Open workflow settings</Link></div>
   </section>
  </div>
  <AdminSettingsEditor category="support" title="Support Settings" description="Support availability, ticket defaults, guest access, attachments and customer lifecycle controls."/>
 </div>;
}
