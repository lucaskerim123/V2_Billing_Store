export type IntegrationContribution = { adminPages:ReadonlyArray<{label:string;route:string;entrypoint:string}>;adminMenu:ReadonlyArray<{label:string;route:string;permission:string}> };
export type BuiltinIntegration = {
  id:string; name:string; description:string; version:string; publisher:string;
  distribution:"bundled"; installable:boolean; sourceRepository:string; sourcePath:string; billingExtensionPath:string;
  sourceWorkspaceBuildOnly:boolean; hostAdapted:boolean; requiredEnvironment:string[];
  features:string[]; route:string; entrypoints:Readonly<Record<string,string>>; contributions:IntegrationContribution;
};
export const BUILTIN_INTEGRATIONS:ReadonlyArray<BuiltinIntegration>;
export function discoverIntegrations(directory?:string):ReadonlyArray<BuiltinIntegration>;
export function getBuiltinIntegration(id:string):BuiltinIntegration|null;
export function validateBuiltinIntegration(manifest:unknown):boolean;
export function canRunIntegration(state:unknown):boolean;
