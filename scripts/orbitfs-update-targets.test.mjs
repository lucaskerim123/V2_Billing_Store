import test from "node:test";
import assert from "node:assert/strict";
import {selectApplicableUpdateTargets} from "../src/lib/orbitfs-update-targets.mjs";

test("Base-only installation applies Base patch and skips absent Engine/add-ons", () => {
  const result=selectApplicableUpdateTargets(
    ["base","engine-shared","mcp"],
    ["base","engine-shared","mcp"],
    {state:"not_deployed",projectId:null,deploymentId:null},
    {}
  );
  assert.deepEqual(result.components,["base"]);
  assert.deepEqual(result.skippedComponents,["engine-shared","mcp"]);
  assert.equal(result.engineInstalled,false);
});

test("Engine deployment allows only License Manager authorised targets", () => {
  const result=selectApplicableUpdateTargets(
    ["base","engine-shared"],
    ["base","engine-shared","mcp"],
    {state:"ready",projectId:"prj-engine",deploymentId:"dpl-engine"},
    {}
  );
  assert.deepEqual(result.components,["base","engine-shared"]);
  assert.deepEqual(result.skippedComponents,["mcp"]);
  assert.equal(result.engineInstalled,true);
});

test("Verified Inner Deployer connection recovers installed Engine inventory", () => {
  const result=selectApplicableUpdateTargets(
    ["base","engine-shared"],
    ["base","engine-shared"],
    null,
    {autoVerified:true,provenance:"inner-deployer-v1",engineProjectId:"prj-engine"}
  );
  assert.deepEqual(result.components,["base","engine-shared"]);
});

test("Unverified or unrelated Engine metadata never enables Engine targets", () => {
  const result=selectApplicableUpdateTargets(
    ["engine-shared"],
    ["engine-shared"],
    null,
    {autoVerified:false,provenance:"external",engineProjectId:"prj-manual"}
  );
  assert.deepEqual(result.components,[]);
  assert.deepEqual(result.skippedComponents,["engine-shared"]);
});
