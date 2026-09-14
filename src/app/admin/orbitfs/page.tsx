"use client";
import Link from "next/link";

const items=[
 {title:"Release Publication",href:"/admin/orbitfs/releases",eyebrow:"RELEASE SYSTEM · CUSTOMER PUBLICATION",text:"Receive final Base and Update release drafts from License Master and publish them to customers. Master remains the technical release authority."},
 {title:"Base Deployment",href:"/admin/orbitfs/base-deploy",eyebrow:"DEPLOYMENT · BASE",text:"Deploy and redeploy the OrbitFS Base Panel from the published Base release. Deployment execution remains in License Master."},
 {title:"Update Release Deployer",href:"/admin/orbitfs/update-release-deployer",eyebrow:"DEPLOYMENT · UPDATES",text:"Select a published Update release and explicitly deploy it to existing customer installations without replacing their Vercel project or Supabase database."}
];
export default function MyOrbitFSAdmin(){return <main className="lmPage"><div className="lmHero"><div><div className="lmEyebrow">ORBITFS CONTROL PLANE</div><h1>My OrbitFS</h1><p>Billing Store customer-facing control surfaces for the License Master release, licensing and deployment authority.</p></div></div><section className="lmGrid2">{items.map(item=><Link className="lmCard" href={item.href} key={item.href} style={{textDecoration:"none"}}><div className="lmKicker">{item.eyebrow}</div><h2>{item.title}</h2><p className="muted">{item.text}</p><span style={{display:"inline-block",marginTop:14}}>Open →</span></Link>)}</section><section className="lmCard" style={{marginTop:14}}><div className="lmKicker">ARCHITECTURE</div><h2>Master → Store → Customer</h2><p className="muted">License Master performs the technical work and sends a final draft here. Billing Store decides when that draft is customer-visible. My OrbitFS then exposes the customer deployment controls while Master remains authoritative underneath.</p></section></main>;
}
