import {masterDatabasePackage} from "@/lib/master-api";

export type ReleaseDatabasePackageReference={
  id:string;
  component:"base"|"engine-shared"|"mcp"|"apex"|"studio";
  databaseSchemaVersion:number;
  sha256:string;
  sourceCommit:string;
};

export type ResolvedReleaseDatabasePackage={
  reference:ReleaseDatabasePackageReference;
  record:any;
  payload:any;
};

const COMPONENTS=new Set(["base","engine-shared","mcp","apex","studio"]);

function packageError(message:string,code="DATABASE_PACKAGE_INVALID",status=422):never{
  throw Object.assign(new Error(message),{status,code});
}

export function releaseDatabasePackageReferences(release:any):ReleaseDatabasePackageReference[]{
  const contract=release?.manifest?.databasePackages;
  if(!contract)return [];
  if(contract.format!=="orbitfs-database-package-set-v1"||!Array.isArray(contract.packages)){
    packageError("Release database package contract is invalid","DATABASE_PACKAGE_CONTRACT_INVALID");
  }
  const seen=new Set<string>();
  return contract.packages.map((raw:any)=>{
    const id=String(raw?.id||"").trim();
    const component=String(raw?.component||"").trim().toLowerCase();
    const databaseSchemaVersion=Number(raw?.databaseSchemaVersion);
    const sha256=String(raw?.sha256||"").trim().toLowerCase();
    const sourceCommit=String(raw?.sourceCommit||"").trim().toLowerCase();
    if(!/^[0-9a-f-]{36}$/i.test(id)||!COMPONENTS.has(component)||!Number.isInteger(databaseSchemaVersion)||databaseSchemaVersion<1||!/^[a-f0-9]{64}$/.test(sha256)||!/^[a-f0-9]{40}$/.test(sourceCommit)){
      packageError("Release contains an invalid database package reference","DATABASE_PACKAGE_REFERENCE_INVALID");
    }
    if(seen.has(component))packageError("Release contains duplicate database package component references","DATABASE_PACKAGE_REFERENCE_DUPLICATE");
    seen.add(component);
    return {id,component:component as ReleaseDatabasePackageReference["component"],databaseSchemaVersion,sha256,sourceCommit};
  });
}

export function releaseHasDatabasePackageContract(release:any){
  return Boolean(release?.manifest?.databasePackages);
}

export async function resolveReleaseDatabasePackage(release:any,component:ReleaseDatabasePackageReference["component"]):Promise<ResolvedReleaseDatabasePackage>{
  const refs=releaseDatabasePackageReferences(release);
  const reference=refs.find(ref=>ref.component===component);
  if(!reference)packageError(`Release is missing its ${component} database package reference`,"DATABASE_PACKAGE_REFERENCE_MISSING",409);
  const body=await masterDatabasePackage(reference.id,"deployer");
  const record=body?.package;
  const payload=record?.payload;
  if(body?.ok!==true||!record||!payload)packageError(`License Manager did not return database package ${reference.id}`,"DATABASE_PACKAGE_UNAVAILABLE",502);
  if(String(record.id)!==reference.id||String(record.component||"").toLowerCase()!==reference.component){
    packageError("License Manager database package identity does not match the approved release","DATABASE_PACKAGE_IDENTITY_MISMATCH");
  }
  if(Number(record.databaseSchemaVersion)!==reference.databaseSchemaVersion||String(record.sha256||"").toLowerCase()!==reference.sha256||String(record.sourceCommit||"").toLowerCase()!==reference.sourceCommit){
    packageError("License Manager database package metadata does not match the approved release reference","DATABASE_PACKAGE_REFERENCE_MISMATCH");
  }
  if(!["current","superseded"].includes(String(record.status||"").toLowerCase())){
    packageError("Approved release database package is not an immutable published package in License Manager","DATABASE_PACKAGE_NOT_PUBLISHED",409);
  }
  if(payload.format!=="orbitfs-customer-database-package-v1"||String(payload.component||"").toLowerCase()!==reference.component||Number(payload.databaseSchemaVersion)!==reference.databaseSchemaVersion||String(payload.sourceCommit||"").toLowerCase()!==reference.sourceCommit){
    packageError("License Manager database package payload does not match its registry record","DATABASE_PACKAGE_PAYLOAD_MISMATCH");
  }
  return {reference,record,payload};
}
