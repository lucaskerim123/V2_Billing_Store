"use client";

import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

type Surface="admin"|"customer";

type ActiveTheme={id:string;name:string;surface:Surface;version:string;is_builtin:boolean;css_text?:string|null};
type ThemeChangedDetail={surface:Surface;id:string};

export default function ThemeRuntime({surface,fallback}:{surface:Surface;fallback:string}){
  const [theme,setTheme]=useState<ActiveTheme|null>(null);

  useEffect(()=>{
    const sb=createClient();
    let live=true;

    const applyTheme=(next:ActiveTheme)=>{
      if(!live)return;
      setTheme(next);
      document.documentElement.dataset.orbitfsTheme=next.id||fallback;
      document.documentElement.dataset.orbitfsThemeSurface=surface;
    };

    const load=async()=>{
      const {data}=await sb.rpc("orbitfs_active_theme",{p_surface:surface});
      applyTheme((data||{id:fallback,name:fallback,surface,version:"1.0.0",is_builtin:true}) as ActiveTheme);
    };

    const onChanged=(event:Event)=>{
      const detail=(event as CustomEvent<ThemeChangedDetail>).detail;
      if(detail?.surface===surface)void load();
    };

    void load();
    window.addEventListener("orbitfs-theme-changed",onChanged as EventListener);
    return()=>{
      live=false;
      window.removeEventListener("orbitfs-theme-changed",onChanged as EventListener);
    };
  },[surface,fallback]);

  // Built-in V3/V5 themes are bundled statically and selected by data-orbitfs-theme.
  // Imported themes remain runtime CSS so Theme Manager can still install custom packages.
  if(!theme?.css_text||theme.is_builtin)return null;
  return <style data-orbitfs-runtime-theme={theme.id} dangerouslySetInnerHTML={{__html:theme.css_text}}/>;
}
