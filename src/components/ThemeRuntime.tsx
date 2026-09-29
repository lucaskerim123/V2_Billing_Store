"use client";

import {useEffect} from "react";
import {createClient} from "@/lib/supabase";

type ThemeSurface="admin"|"customer";
type ActiveTheme={
  id?:string;
  manifest?:Record<string,unknown>|null;
  css_text?:string|null;
};

function compatibilityAttr(surface:ThemeSurface,theme:ActiveTheme){
  const manifest=theme.manifest||{};
  const explicit=String(manifest.compatibility_theme_attr||"").trim();
  if(explicit)return explicit;
  if(surface==="admin")return "v3";
  if(theme.id==="V3C"||theme.id==="V5C")return "V3C";
  return String(theme.id||"V3C");
}

function applyThemeToDocument(surface:ThemeSurface,theme:ActiveTheme){
  if(!theme.id)return;
  const root=document.documentElement;
  const styleId="orbitfs-runtime-"+surface+"-theme";
  const idAttr=surface==="admin"?"data-admin-theme-id":"data-customer-theme-id";
  const compatAttr=surface==="admin"?"data-admin-theme":"data-customer-theme";
  root.setAttribute(idAttr,theme.id);
  root.setAttribute(compatAttr,compatibilityAttr(surface,theme));

  document.getElementById(styleId)?.remove();
  if(theme.css_text){
    const style=document.createElement("style");
    style.id=styleId;
    style.dataset.orbitfsTheme=theme.id;
    style.textContent=theme.css_text;
    document.head.appendChild(style);
  }
}

export default function ThemeRuntime({surface}:{surface:ThemeSurface}){
  useEffect(()=>{
    const sb=createClient();
    let alive=true;
    let channel:BroadcastChannel|null=null;

    async function refresh(){
      const {data,error}=await sb.rpc("orbitfs_active_theme",{p_surface:surface});
      if(!alive||error||!data)return;
      applyThemeToDocument(surface,data as ActiveTheme);
    }

    const eventHandler=(event:Event)=>{
      const detail=(event as CustomEvent<{surface?:ThemeSurface}>).detail;
      if(!detail?.surface||detail.surface===surface)void refresh();
    };

    void refresh();
    window.addEventListener("orbitfs-theme-changed",eventHandler);

    if(typeof BroadcastChannel!=="undefined"){
      channel=new BroadcastChannel("orbitfs-theme");
      channel.onmessage=(event)=>{
        const changedSurface=event.data?.surface as ThemeSurface|undefined;
        if(!changedSurface||changedSurface===surface)void refresh();
      };
    }

    return()=>{
      alive=false;
      window.removeEventListener("orbitfs-theme-changed",eventHandler);
      channel?.close();
      document.getElementById("orbitfs-runtime-"+surface+"-theme")?.remove();
    };
  },[surface]);

  return null;
}
