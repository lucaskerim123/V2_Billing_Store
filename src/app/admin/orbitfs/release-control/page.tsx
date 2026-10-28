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
  const [mode,setMode]=useState<"update"|"base">("base");
  return <div className="space-y-4">
    <header className="rounded-xl border p-4">
      <h1 className="text-xl font-semibold">Base release review</h1>
      <p className="mt-2 text-sm">Stage 3: review the full Base release first, then prepare Base patches and optional Engine/add-on updates. Technical approval remains with License Manager; publication never deploys production.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Release package type">
        <button type="button" className={mode==="base"?"button-primary":"button-secondary"} aria-pressed={mode==="base"} onClick={()=>setMode("base")}>1. Full Base release</button>
        <button type="button" className={mode==="update"?"button-primary":"button-secondary"} aria-pressed={mode==="update"} onClick={()=>setMode("update")}>2. Base updates / optional components</button>
      </div>
    </header>
    {mode==="update"?<UpdateReleaseReview/>:<BaseReleaseReview/>}
  </div>;
}
