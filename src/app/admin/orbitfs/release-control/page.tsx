"use client";

import {useState} from "react";
import BaseReleaseReview from "../base-deployment/page";
import UpdateReleaseReview from "../update-release-deployer/page";

/**
 * Unified Stage 3 customer-release review. Both release types retain their
 * existing License Manager validation and Billing publication contracts.
 * The operator switches presentation modes, not technical authority.
 */
export default function OrbitFSReleaseReview(){
  const [mode,setMode]=useState<"update"|"base">("update");
  return <div className="space-y-4">
    <header className="rounded-xl border p-4">
      <h1 className="text-xl font-semibold">OrbitFS Release Review</h1>
      <p className="mt-2 text-sm">Stage 3: prepare approved releases for customer presentation. Base is the primary installation; Engine and add-ons remain optional update targets. Publishing does not deploy customer installations.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Release package type">
        <button type="button" className={mode==="update"?"button-primary":"button-secondary"} aria-pressed={mode==="update"} onClick={()=>setMode("update")}>Base and component updates</button>
        <button type="button" className={mode==="base"?"button-primary":"button-secondary"} aria-pressed={mode==="base"} onClick={()=>setMode("base")}>Full Base installation releases</button>
      </div>
    </header>
    {mode==="update"?<UpdateReleaseReview/>:<BaseReleaseReview/>}
  </div>;
}
