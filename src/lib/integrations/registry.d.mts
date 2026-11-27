export type BuiltinIntegration = {
  id:string; name:string; description:string; version:string; publisher:string;
  distribution:"bundled"; installable:boolean; sourceRepository:string; sourcePath:string; billingExtensionPath:string;
  sourceWorkspaceBuildOnly:boolean; hostAdapted:boolean; requiredEnvironment:string[];
  features:string[]; route:string;
};
export const BUILTIN_INTEGRATIONS:ReadonlyArray<BuiltinIntegration>;
export function getBuiltinIntegration(id:string):BuiltinIntegration|null;
export function validateBuiltinIntegration(manifest:unknown):boolean;
export function canRunIntegration(state:unknown):boolean;
