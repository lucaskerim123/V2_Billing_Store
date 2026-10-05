"use client";

import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

type Surface="admin"|"customer";
type ActiveTheme={id:string;name:string;surface:Surface;version:string;is_builtin:boolean;css_text?:string|null;manifest?:{standalone?:boolean}|null};
type ThemeChangedDetail={surface:Surface;id?:string};

const suffixFor=(surface:Surface)=>surface==="admin"?"A":"C";
const validForSurface=(id:string,surface:Surface)=>Boolean(id)&&id.endsWith(suffixFor(surface));

export default function ThemeRuntime({surface,fallback,onResolved}:{surface:Surface;fallback:string;onResolved?:(theme:ActiveTheme)=>void}){
  const [theme,setTheme]=useState<ActiveTheme|null>(null);

  useEffect(()=>{
    const sb=createClient();
    let live=true;
    let channel:BroadcastChannel|null=null;
    const legacyAttribute=surface==="admin"?"data-admin-theme":"data-customer-theme";
    const legacyTheme=document.documentElement.getAttribute(legacyAttribute);

    const fallbackTheme:ActiveTheme={id:fallback,name:fallback,surface,version:"1.0.0",is_builtin:true};

    const applyTheme=(raw:ActiveTheme|null|undefined)=>{
      if(!live)return;
      const next=raw&&raw.surface===surface&&validForSurface(raw.id,surface)?raw:fallbackTheme;
      setTheme(next);
      onResolved?.(next);
      document.documentElement.dataset.orbitfsTheme=next.id;
      document.documentElement.dataset.orbitfsThemeSurface=surface;
      // Standalone themes must not inherit selectors from the legacy visual theme
      // attribute. Overlay themes keep the legacy baseline by design.
      if(next.manifest?.standalone===true)document.documentElement.setAttribute(legacyAttribute,next.id);
      else if(legacyTheme)document.documentElement.setAttribute(legacyAttribute,legacyTheme);
    };

    const load=async()=>{
      const {data,error}=await sb.rpc("orbitfs_active_theme",{p_surface:surface});
      if(error){applyTheme(fallbackTheme);return}
      applyTheme((data||fallbackTheme) as ActiveTheme);
    };

    const onChanged=(event:Event)=>{
      const detail=(event as CustomEvent<ThemeChangedDetail>).detail;
      if(detail?.surface===surface)void load();
    };

    void load();
    window.addEventListener("orbitfs-theme-changed",onChanged as EventListener);

    if(typeof BroadcastChannel!=="undefined"){
      channel=new BroadcastChannel("orbitfs-theme");
      channel.onmessage=(event)=>{
        const detail=event.data as ThemeChangedDetail|undefined;
        if(detail?.surface===surface)void load();
      };
    }

    return()=>{
      live=false;
      window.removeEventListener("orbitfs-theme-changed",onChanged as EventListener);
      channel?.close();
      if(document.documentElement.dataset.orbitfsThemeSurface===surface){
        delete document.documentElement.dataset.orbitfsTheme;
        delete document.documentElement.dataset.orbitfsThemeSurface;
      }
      if(legacyTheme)document.documentElement.setAttribute(legacyAttribute,legacyTheme);
      else document.documentElement.removeAttribute(legacyAttribute);
    };
  },[surface,fallback,onResolved]);

  // Built-in themes are bundled statically and selected by data-orbitfs-theme.
  // Imported themes stay isolated because their CSS exists in the document only while active.
  if(!theme?.css_text||theme.is_builtin)return null;
  return <style data-orbitfs-runtime-theme={theme.id} dangerouslySetInnerHTML={{__html:theme.css_text}}/>;
}
