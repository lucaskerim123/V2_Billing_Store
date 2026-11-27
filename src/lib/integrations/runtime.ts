import {BUILTIN_INTEGRATIONS} from "./generated-runtime";
export {BUILTIN_INTEGRATIONS};
export function getBuiltinIntegration(id:string){return BUILTIN_INTEGRATIONS.find(item=>item.id===id)||null;}
export function canRunIntegration(state:unknown):boolean{
 if(!state||typeof state!=="object")return false;
 const value=state as {installed?:unknown;enabled?:unknown};
 return value.installed===true&&value.enabled===true;
}
