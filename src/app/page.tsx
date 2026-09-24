import Link from "next/link";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

const baseFeatures=[
 {code:"FL",title:"Files & structure",text:"Keep documents, source material and working files organised inside the OrbitFS structure instead of scattering project information between unrelated tools."},
 {code:"PF",title:"Profiles & reusable context",text:"Maintain person, project and system profiles that can be reused across workspaces and connected workflows without rebuilding the same context every time."},
 {code:"WS",title:"Workspaces",text:"Create focused working areas for different projects, choose what each workspace loads, and keep project-specific information separate while still using one OrbitFS foundation."},
 {code:"PM",title:"Permissions & management",text:"Control who can view, edit and manage system areas, profiles, files and commands while keeping system-level and workspace-level roles distinct."}
];

const addons=[
 {key:"mcp",index:"01",name:"OrbitFS MCP",tag:"Connected context",summary:"The connection layer between OrbitFS and supported AI or MCP clients.",body:"MCP makes the information already organised in OrbitFS available where you are actually working. It can load the right workspace, profiles and project context, expose approved OrbitFS commands and keep client sessions aligned with the same source information instead of manually rebuilding context in every conversation.",points:["Workspace and project startup","Profile and context loading","Supported client connections","OrbitFS commands and tools","Reusable project context"]},
 {key:"apex",index:"02",name:"OrbitFS Apex",tag:"Sort & convert",summary:"The ingestion, sorting and conversion layer for incoming material.",body:"Apex takes raw or incoming material and prepares it for OrbitFS. It can classify content, convert supported formats, organise output and route prepared material into the structure your workspace expects, reducing the amount of manual sorting required before the information is useful.",points:["Incoming-file sorting","Format conversion","Classification and preparation","Structured output","Workflow routing"]},
 {key:"studio",index:"03",name:"OrbitFS Studio",tag:"Create & edit",summary:"The focused document and journal workspace built around OrbitFS context.",body:"Studio gives document-heavy workflows a dedicated surface without disconnecting them from the rest of OrbitFS. It can work from the same files, profiles and workspace context, then create or update documents and journal-style content that remains part of the wider OrbitFS environment.",points:["Document workflows","Journal workflows","Context-aware creation","Editing and refinement","OrbitFS-connected output"]}
];

const workflow=[
 {n:"01",title:"Organise the core",text:"Base holds the files, profiles, workspaces and project structure that define the source information for the rest of the system."},
 {n:"02",title:"Choose the workspace",text:"A workspace decides what is relevant for the current project: which files load, which profiles matter, what is editable and what stays available only when needed."},
 {n:"03",title:"Use the right add-on",text:"MCP connects context to supported clients, Apex prepares incoming material, and Studio handles focused document and journal creation."},
 {n:"04",title:"Keep everything connected",text:"The output returns to the same OrbitFS environment, so the next workflow can use the updated information instead of starting from scratch."}
];

export default async function Home(){
 const sb=createClient(url,publicKey,{auth:{persistSession:false}});
 const [newsResult,settingsResult]=await Promise.all([
  sb.from("news_posts").select("slug,title,excerpt,category,published_at,show_on_homepage").eq("published",true).eq("category","product_updates").eq("show_on_homepage",true).order("published_at",{ascending:false}).limit(3),
  sb.from("app_settings").select("key,value").eq("public_read",true)
 ]);
 const news=newsResult.data||[];
 const settings=Object.fromEntries((settingsResult.data||[]).map((x:any)=>[x.key,x.value])) as Record<string,any>;
 const site=settings["identity.site_name"]||"OrbitFS";
 const logoText=settings["site.logo_text"]||site;
 const showNews=settings["site.show_news"]!==false;

 return <main className="orbitHome">
  <style>{`
   .orbitHome{
    background-color:#020713!important;
    background-image:
     radial-gradient(circle,rgba(255,255,255,.72) 0 1px,transparent 1.45px),
     radial-gradient(circle,rgba(63,214,255,.70) 0 1px,transparent 1.55px),
     radial-gradient(circle,rgba(168,103,255,.62) 0 1px,transparent 1.55px),
     radial-gradient(ellipse 72% 56% at 8% 14%,rgba(0,164,255,.30),transparent 67%),
     radial-gradient(ellipse 66% 52% at 88% 10%,rgba(131,61,255,.32),transparent 65%),
     radial-gradient(ellipse 58% 46% at 54% 58%,rgba(31,88,211,.18),transparent 72%),
     radial-gradient(ellipse 62% 45% at 82% 84%,rgba(103,39,218,.16),transparent 70%),
     linear-gradient(135deg,#020713 0%,#061426 36%,#0a1534 68%,#030711 100%)!important;
    background-size:113px 113px,179px 179px,257px 257px,auto,auto,auto,auto,auto!important;
    background-position:0 0,41px 63px,87px 29px,0 0,0 0,0 0,0 0,0 0!important;
   }
   .orbitHome::before{
    content:""!important;
    position:fixed!important;
    inset:0!important;
    z-index:0!important;
    pointer-events:none!important;
    opacity:1!important;
    transform:none!important;
    mask-image:none!important;
    background:
     radial-gradient(ellipse 48% 32% at 14% 8%,rgba(33,213,255,.15),transparent 72%),
     radial-gradient(ellipse 46% 34% at 84% 17%,rgba(155,70,255,.17),transparent 72%),
     radial-gradient(ellipse 38% 28% at 51% 92%,rgba(51,116,255,.10),transparent 76%)!important;
   }
   .orbitHome::after{
    content:""!important;
    position:fixed!important;
    inset:-8%!important;
    z-index:0!important;
    pointer-events:none!important;
    opacity:.8!important;
    background:
     radial-gradient(ellipse at 18% 20%,transparent 58%,rgba(49,218,255,.16) 58.5%,transparent 59.5%),
     radial-gradient(ellipse at 83% 27%,transparent 61%,rgba(151,76,255,.14) 61.5%,transparent 62.5%),
     linear-gradient(115deg,transparent 0 47%,rgba(94,142,255,.035) 48%,transparent 49% 100%)!important;
    transform:rotate(-4deg)!important;
   }
   .orbitHome>header,.orbitHome>section,.orbitHome>footer{position:relative!important;z-index:2!important}
   .orbitHomeTop{justify-content:space-between!important}
   .orbitHomeNavLeft{display:flex;align-items:center;gap:34px;min-width:0}
   .orbitHomeNavSections{gap:18px}
   .orbitHomeNavActions{margin-left:auto;gap:10px}
   .orbitHomeNavActions .orbitHomeNavCta:first-child{border-color:rgba(48,211,255,.48);background:rgba(16,91,122,.13)}
   .orbitHomeNavActions .orbitHomeNavCta:last-child{border-color:rgba(151,76,255,.72);background:rgba(68,34,115,.24)}
   .orbitHomeHero::before,.orbitHomeHero::after{content:"";position:absolute;pointer-events:none;z-index:-1;border-radius:50%}
   .orbitHomeHero::before{width:720px;height:260px;left:-250px;top:8%;border:1px solid rgba(48,211,255,.24);transform:rotate(-18deg);box-shadow:0 0 80px rgba(48,211,255,.09)}
   .orbitHomeHero::after{width:860px;height:310px;right:-360px;bottom:4%;border:1px solid rgba(151,76,255,.22);transform:rotate(14deg);box-shadow:0 0 90px rgba(151,76,255,.08)}
   @media(max-width:1080px){
    .orbitHomeNavLeft{gap:18px}
    .orbitHomeNavSections{gap:12px;font-size:11px}
    .orbitHomeNavActions{gap:7px}
    .orbitHomeNavActions .orbitHomeNavCta{padding:8px 10px;font-size:10px}
   }
   @media(max-width:800px){
    .orbitHomeTop{display:flex!important;gap:9px!important}
    .orbitHomeNavLeft{gap:0;flex:1}
    .orbitHomeNavSections{display:none!important}
    .orbitHomeNavActions{display:flex!important;margin-left:auto!important}
    .orbitHomeNavActions .orbitHomeNavCta{display:inline-flex!important;white-space:nowrap}
    .orbitHome{background-size:89px 89px,137px 137px,211px 211px,auto,auto,auto,auto,auto!important}
   }
   @media(max-width:520px){
    .orbitHomeNavActions{gap:5px}
    .orbitHomeNavActions .orbitHomeNavCta{padding:7px 8px!important;font-size:9px!important}
    .orbitHomeHero::before{width:430px;height:150px;left:-250px;top:3%}
    .orbitHomeHero::after{width:480px;height:170px;right:-300px;bottom:8%}
   }
  `}</style>

  <header className="orbitHomeTop">
   <div className="orbitHomeNavLeft">
    <Link className="orbitHomeBrand" href="/"><span className="orbitHomeMark" aria-hidden="true"/><span>{logoText}</span></Link>
    <nav className="orbitHomeNav orbitHomeNavSections" aria-label="Main navigation">
     <a className="orbitHomeNavOptional" href="#overview">Overview</a>
     <a className="orbitHomeNavOptional" href="#base">Base</a>
     <a className="orbitHomeNavOptional" href="#addons">Add-ons</a>
     <a className="orbitHomeNavOptional" href="#workflow">Workflow</a>
     {showNews&&<Link className="orbitHomeNavOptional" href="/news">News</Link>}
    </nav>
   </div>
   <nav className="orbitHomeNav orbitHomeNavActions" aria-label="Account and support">
    <Link className="orbitHomeNavCta" href="/support">Support</Link>
    <Link className="orbitHomeNavCta" href="/portal">Customer Portal</Link>
   </nav>
  </header>

  <section className="orbitHomeHero" id="overview">
   <div className="orbitHomeHeroCopy">
    <p className="orbitHomeEyebrow">OrbitFS main system</p>
    <h1>One system for your <span>files, profiles, workspaces and connected workflows.</span></h1>
    <p className="orbitHomeLead">OrbitFS is a modular working environment built around one consistent source of project information. Base organises the core system; add-ons extend it for connected context, sorting, conversion, documents and journal workflows without turning every job into a separate disconnected app.</p>
    <div className="orbitHomeActions">
     <a className="orbitHomePrimary" href="#base">Explore OrbitFS <span aria-hidden="true">→</span></a>
     <a className="orbitHomeSecondary" href="#addons">See the add-ons</a>
    </div>
    <div className="orbitHomeHeroFlags"><span>Base system</span><span>Workspace driven</span><span>Profile aware</span><span>Modular add-ons</span></div>
   </div>

   <div className="orbitHomeHeroPanel" aria-label="OrbitFS system overview">
    <div className="orbitHomePanelTop"><span>ORBITFS SYSTEM</span><span className="orbitHomePanelLive"><i/>CONNECTED</span></div>
    <div className="orbitHomeSystemCore">
     <span className="orbitHomeSystemRing"/><span className="orbitHomeSystemRing orbitHomeSystemRingTwo"/>
     <div className="orbitHomeSystemPlanet"><strong>Base</strong><small>CORE SYSTEM</small></div>
     <div className="orbitHomeSystemNode nodeFiles"><b>FILES</b><small>structure + content</small></div>
     <div className="orbitHomeSystemNode nodeProfiles"><b>PROFILES</b><small>reusable context</small></div>
     <div className="orbitHomeSystemNode nodeWorkspaces"><b>WORKSPACES</b><small>project focus</small></div>
     <div className="orbitHomeSystemNode nodeMcp"><b>MCP</b><small>connected clients</small></div>
     <div className="orbitHomeSystemNode nodeApex"><b>APEX</b><small>sort + convert</small></div>
     <div className="orbitHomeSystemNode nodeStudio"><b>STUDIO</b><small>create + edit</small></div>
    </div>
    <div className="orbitHomePanelFoot"><span>CORE</span><b>Base stays central</b><span>ADD-ONS</span><b>Extend the workflow</b></div>
   </div>
  </section>

  <section className="orbitHomeStrip" aria-label="OrbitFS fundamentals">
   <article><span>01</span><div><b>One foundation</b><small>Files, profiles and workspaces stay under the same OrbitFS system.</small></div></article>
   <article><span>02</span><div><b>Context that carries forward</b><small>Reuse organised information instead of rebuilding project context for every tool.</small></div></article>
   <article><span>03</span><div><b>Focused add-ons</b><small>Add specialist capability only where the workflow needs it.</small></div></article>
  </section>

  <section className="orbitHomeSection" id="base">
   <div className="orbitHomeSectionHead">
    <div><p className="orbitHomeKicker">OrbitFS Base</p><h2>The core system everything else works from.</h2></div>
    <p>Base is not just a launcher for add-ons. It is the working foundation: the place where files, profiles, workspaces, project structure, permissions and system-level controls stay organised.</p>
   </div>

   <div className="orbitHomeBaseLayout">
    <article className="orbitHomeBaseHero">
     <div className="orbitHomeBaseTop"><span className="orbitHomeBadge">Core system</span><span>BASE</span></div>
     <h3>Keep the source information stable while the workflow changes around it.</h3>
     <p>Instead of giving every project or add-on its own isolated copy of the same information, OrbitFS Base keeps the underlying material together. Workspaces decide what is relevant, profiles keep reusable context available, and add-ons operate around that shared foundation.</p>
     <div className="orbitHomeBaseFlow"><span>FILES</span><i>→</i><span>WORKSPACE</span><i>→</i><span>CONTEXT</span><i>→</i><span>WORKFLOW</span></div>
    </article>
    <div className="orbitHomeFeatureGrid">
     {baseFeatures.map(feature=><article className="orbitHomeFeatureCard" key={feature.code}><div className="orbitHomeFeatureCode">{feature.code}</div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}
    </div>
   </div>
  </section>

  <section className="orbitHomeSection orbitHomeWorkspaceSection">
   <div className="orbitHomeSectionHead">
    <div><p className="orbitHomeKicker">Workspace driven</p><h2>Load what matters for the project you are actually working on.</h2></div>
    <p>OrbitFS workspaces let the same Base system behave differently for different projects without duplicating the whole environment.</p>
   </div>
   <div className="orbitHomeWorkspaceGrid">
    <article><span>LOAD FIRST</span><h3>Core information</h3><p>Choose files or folders that should always be available when a workspace starts, including the core context the project depends on.</p></article>
    <article><span>WHEN RELEVANT</span><h3>Conditional material</h3><p>Keep supporting files and reference material available without forcing every item into every session or workflow.</p></article>
    <article><span>CONTROL</span><h3>Status & permissions</h3><p>Define whether material is active, final, editable, locked or permission-controlled while keeping the workspace configuration understandable.</p></article>
    <article><span>ADD-ONS</span><h3>Same project, more capability</h3><p>Connected add-ons work from the workspace context rather than building a second project model beside OrbitFS.</p></article>
   </div>
  </section>

  <section className="orbitHomeSection" id="addons">
   <div className="orbitHomeSectionHead">
    <div><p className="orbitHomeKicker">OrbitFS add-ons</p><h2>Specialised systems that extend Base without replacing it.</h2></div>
    <p>Each add-on has a specific job. They are designed to use the same OrbitFS project structure and context rather than becoming separate islands of information.</p>
   </div>
   <div className="orbitHomeAddonStack">
    {addons.map(addon=><article className={`orbitHomeAddonCard addon-${addon.key}`} key={addon.key}>
     <div className="orbitHomeAddonIndex">{addon.index}</div>
     <div className="orbitHomeAddonMain">
      <p className="orbitHomeAddonTag">{addon.tag}</p>
      <h3>{addon.name}</h3>
      <strong>{addon.summary}</strong>
      <p>{addon.body}</p>
     </div>
     <div className="orbitHomeAddonPoints">
      {addon.points.map(point=><span key={point}><i/> {point}</span>)}
     </div>
    </article>)}
   </div>
  </section>

  <section className="orbitHomeSection" id="workflow">
   <div className="orbitHomeSectionHead">
    <div><p className="orbitHomeKicker">How OrbitFS works</p><h2>Organise once, then let each workflow use the same foundation.</h2></div>
    <p>The system is designed so the core project information survives changes in tools, clients and workflows. The add-on changes; the foundation does not.</p>
   </div>
   <div className="orbitHomeWorkflow">
    {workflow.map(step=><article key={step.n}><div className="orbitHomeWorkflowNo">{step.n}</div><div><h3>{step.title}</h3><p>{step.text}</p></div></article>)}
   </div>
  </section>

  <section className="orbitHomePrinciples">
   <div className="orbitHomePrinciplesIntro"><p className="orbitHomeKicker">System design</p><h2>OrbitFS is built around continuity, not isolated tools.</h2><p>Files, profiles, permissions and workspace configuration remain the durable layer. Components can be installed, configured, tested, attached, detached, repaired, upgraded or removed around that foundation.</p></div>
   <div className="orbitHomePrincipleCards">
    <article><b>MODULAR</b><h3>Add capability without rebuilding Base.</h3><p>New components extend the environment while the core system remains understandable and stable.</p></article>
    <article><b>CONTEXT AWARE</b><h3>Use the right information in the right workspace.</h3><p>Projects can load their own core files, profiles and references without forcing unrelated material into the workflow.</p></article>
    <article><b>PERMISSION AWARE</b><h3>System and workspace access stay distinct.</h3><p>OrbitFS can keep global system authority separate from project-level ownership and editing permissions.</p></article>
   </div>
  </section>

  {showNews&&<section className="orbitHomeSection" id="news">
   <div className="orbitHomeSectionHead"><div><p className="orbitHomeKicker">Product News and Updates</p><h2>Latest OrbitFS product updates.</h2></div><Link className="orbitHomeTextLink" href="/news">View all news →</Link></div>
   <div className="orbitHomeNewsGrid">{news.length?news.map((item:any)=><Link className="orbitHomeNewsCard" href={`/news/${item.slug}`} key={item.slug}><span>Product News and Updates</span><h3>{item.title}</h3><p>{item.excerpt}</p><b>Read update →</b></Link>):<article className="orbitHomeNewsCard"><span>Product News and Updates</span><h3>No published product updates yet</h3><p>Published OrbitFS product news will appear here automatically.</p></article>}</div>
  </section>}

  <section className="orbitHomeSection">
   <div className="orbitHomeSectionHead"><div><p className="orbitHomeKicker">Quick answers</p><h2>What each part of OrbitFS is responsible for.</h2></div><p>Base holds the durable project environment. Add-ons handle specialised jobs while staying connected to that same information.</p></div>
   <div className="orbitHomeFaq">
    <details><summary>What is OrbitFS Base?</summary><p>Base is the main OrbitFS system: files, profiles, workspaces, project structure, permissions and system management. It is the foundation the add-ons work around.</p></details>
    <details><summary>What does a workspace do?</summary><p>A workspace defines the project-specific working context: what should load first, what is relevant only when needed, which profiles and files matter, and how that material should be treated.</p></details>
    <details><summary>What does OrbitFS MCP do?</summary><p>MCP connects approved OrbitFS context, startup behaviour, projects, commands and supported clients so the information already organised in OrbitFS can be used directly in connected workflows.</p></details>
    <details><summary>What does OrbitFS Apex do?</summary><p>Apex is the sorter and converter. It prepares incoming material by classifying, converting and structuring it before the rest of the OrbitFS workflow uses it.</p></details>
    <details><summary>What does OrbitFS Studio do?</summary><p>Studio is the document and journal-focused creation layer. It works from OrbitFS context and produces content that remains connected to the wider system.</p></details>
   </div>
  </section>

  <section className="orbitHomeCta">
   <div><p className="orbitHomeKicker">OrbitFS</p><h2>One foundation. The right tools around it.</h2><p>Keep your project information organised in Base and extend the workflow with the components you actually need.</p></div>
   <div className="orbitHomeCtaActions"><a className="orbitHomePrimary" href="#addons">Explore add-ons</a><Link className="orbitHomeSecondary" href="/portal">Customer Portal</Link></div>
  </section>

  <footer className="orbitHomeFooter"><div><span className="orbitHomeFooterBrand"><span className="orbitHomeMark" aria-hidden="true"/>{site}</span><small>Main OrbitFS system · files, profiles, workspaces and connected workflows</small></div><nav>{showNews&&<Link href="/news">News</Link>}<Link href="/support">Support</Link><Link href="/portal">Customer Portal</Link></nav></footer>
 </main>;
}
