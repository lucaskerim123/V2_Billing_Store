export type IntegrationPageContribution = {label:string;route:string;entrypoint:string;permission:string};
export type IntegrationMenuContribution = {label:string;route:string;permission:string;group?:string};
export type IntegrationContribution = {adminPages:ReadonlyArray<IntegrationPageContribution>;adminMenu:ReadonlyArray<IntegrationMenuContribution>};
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
