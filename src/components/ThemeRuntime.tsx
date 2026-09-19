"use client";

import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

type Surface="admin"|"customer";

type ActiveTheme={id:string;name:string;surface:Surface;version:string;is_builtin:boolean;css_text?:string|null};

export default function ThemeRuntime({surface,fallback}:{surface:Surface;fallback:string}){
  const [theme,setTheme]=useState<ActiveTheme|null>(null);

  useEffect(()=>{
    const sb=createClient();
    let live=true;
    (async()=>{
      const {data}=await sb.rpc("orbitfs_active_theme",{p_surface:surface});
      if(!live)return;
      const next=(data||{id:fallback,name:fallback,surface,version:"1.0.0",is_builtin:true}) as ActiveTheme;
      setTheme(next);
      document.documentElement.dataset.orbitfsTheme=next.id||fallback;
      document.documentElement.dataset.orbitfsThemeSurface=surface;
    })();
    return()=>{live=false};
  },[surface,fallback]);

  // Built-in V3A/V3C styles are already bundled statically. Re-injecting the full
  // stylesheet after an async Supabase RPC causes a late layout/style shift.
  if(!theme?.css_text||theme.is_builtin)return null;
  return <style data-orbitfs-runtime-theme={theme.id} dangerouslySetInnerHTML={{__html:theme.css_text}}/>;
}
