"use client";

import {useEffect,useId,useRef,type ReactNode} from "react";

type Props={
  open:boolean;
  title:string;
  description:string;
  confirmLabel:string;
  cancelLabel?:string;
  busy?:boolean;
  danger?:boolean;
  children?:ReactNode;
  onCancel:()=>void;
  onConfirm:()=>void;
};

export default function V6ConfirmDialog({
  open,title,description,confirmLabel,cancelLabel="Cancel",busy=false,danger=false,children,onCancel,onConfirm
}:Props){
  const titleId=useId();
  const descriptionId=useId();
  const panelRef=useRef<HTMLElement|null>(null);
  const cancelRef=useRef<HTMLButtonElement|null>(null);

  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const timer=window.setTimeout(()=>cancelRef.current?.focus(),0);
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!busy){
        event.preventDefault();
        onCancel();
        return;
      }
      if(event.key!=="Tab")return;
      const panel=panelRef.current;
      if(!panel)return;
      const focusable=Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'
      )).filter(node=>node.offsetParent!==null);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>{
      window.clearTimeout(timer);
      document.removeEventListener("keydown",onKeyDown);
      document.body.style.overflow=previousOverflow;
      previous?.focus?.();
    };
  },[open,busy,onCancel]);

  if(!open)return null;

  return <div className="v6ConfirmBackdrop" role="presentation" onMouseDown={()=>{if(!busy)onCancel()}}>
    <section
      ref={panelRef}
      className="v6ConfirmDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={event=>event.stopPropagation()}
    >
      <span className="v6ConfirmKicker">CONFIRM ACTION</span>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {children&&<div className="v6ConfirmBody">{children}</div>}
      <div className="v6ConfirmActions">
        <button ref={cancelRef} type="button" className="secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={danger?"danger":""} disabled={busy} onClick={onConfirm}>{busy?"Working…":confirmLabel}</button>
      </div>
    </section>
  </div>;
}
