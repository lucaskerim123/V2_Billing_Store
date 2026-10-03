import type { ReactNode } from "react";
import "@/themes/active/admin.css";
import AdminLayoutClient from "./AdminLayoutClient";

type GithubProfileStatus="primary"|"fallback"|"unknown";

async function githubProfileStatus():Promise<GithubProfileStatus>{
  try{
    const response=await fetch("https://dev.incendiarynetworks.cc/api/github-profile",{cache:"no-store",signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error("Profile endpoint unavailable");
    const body=await response.json();
    if(body?.profile==="fallback")return "fallback";
    if(body?.profile==="primary")return "primary";
  }catch{}
  return "unknown";
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const githubProfile=await githubProfileStatus();
  return <AdminLayoutClient githubProfile={githubProfile}>{children}</AdminLayoutClient>;
}
