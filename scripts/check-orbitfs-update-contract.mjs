import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const deployer=read("src/lib/orbitfs-customer-deployer.ts");
const master=read("src/lib/master-api.ts");

assert(deployer.includes('await masterExecuteDeployment({action,releaseId:release.id'),"Every customer deployment/update must be authorized by License Manager before mutation.");
assert(deployer.includes('String(planned.body?.release?.id||"")!==String(release.id)'),"V2 must verify Base planned the exact License Manager Engine release.");
assert(deployer.includes('String(host.releaseId||"")!==String(release.id)'),"V2 must verify the completed Engine release identity.");
assert(deployer.includes('host.updaterConnected!==true'),"V2 must require post-update License Manager updater verification.");
assert(master.includes('masterExecuteDeployment(input:any)'),"V2 must use the License Manager deployer API.");
assert(master.includes('"deployer"'),"Deployment authorization must use the deployer-scoped License Manager credential.");
assert(master.includes('masterDownloadReleaseArtifact'),"Release artifacts must be downloaded through License Manager authority.");
console.log("OrbitFS V2 update authority contract checks passed.");
