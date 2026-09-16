"use client";
import Link from "next/link";

const items=[
 {title:"Release Publication",href:"/admin/orbitfs/releases",eyebrow:"RELEASE SYSTEM · CUSTOMER PUBLICATION",text:"Receive final Base and Update release drafts from License Master and publish them to customers. Master remains the technical release authority."},
 {title:"Base Deployment",href:"/admin/orbitfs/base-deploy",eyebrow:"DEPLOYMENT · BASE",text:"Deploy and redeploy the OrbitFS Base Panel from the published Base release. Deployment execution targets the customer's connected Vercel and Supabase accounts."},
 {title:"Update Release Deployer",href:"/admin/orbitfs/update-release-deployer",eyebrow:"DEPLOYMENT · UPDATES",text:"Select a published Update release and deploy it to an existing customer installation without replacing its Vercel project or Supabase database."},
 {title:"License Controller",href:"/admin/license-controller",eyebrow:"LICENSE MASTER · AUTHORITY",text:"View and control customer licenses through the external License Master authority. Billing Store does not become a second licensing authority."},
 {title:"Customer Deployment Center",href:"/portal/orbitfs/deployer",eyebrow:"CUSTOMER CONTROL SURFACE",text:"Open the same deployment surface customers use for Base deployment, updates, rollback and license controls."}
];

export default function MyOrbitFSAdmin(){return <main className="lmPage"><div className="lmHero"><div><div className="lmEyebrow">ORBITFS CONTROL PLANE</div><h1>My OrbitFS</h1><p>Billing Store customer and administrator control surfaces. Commerce and customer state stay here; License Master remains the external authority for licensing and release authority.</p></div></div><section className="lmGrid2">{items.map(item=><Link className="lmCard" href={item.href} key={item.href} style={{textDecoration:"none"}}><div className="lmKicker">{item.eyebrow}</div><h2>{item.title}</h2><p className="muted">{item.text}</p><span style={{display:"inline-block",marginTop:14}}>Open →</span></Link>)}</section><section className="lmCard" style={{marginTop:14}}><div className="lmKicker">ARCHITECTURE</div><h2>Master → Store → Customer</h2><p className="muted">License Master supplies authoritative licensing and release data. Billing Store owns customers, orders, publication visibility and customer deployment state. Customer deployment uses the customer's own connected Vercel and Supabase accounts, so the Store is portable across Vercel accounts.</p></section></main>;
}
