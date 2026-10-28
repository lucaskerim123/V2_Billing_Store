// Physical installation is distinct from the components allowed by a licence.
// Never expand License Manager's authorised targets using local inventory.
export function selectApplicableUpdateTargets(authorised, release, engineState, engineConnection, installedAddons = []) {
  const requested = [...new Set(Array.isArray(release) ? release : [])];
  const permitted = new Set(Array.isArray(authorised) ? authorised : []);
  const state = engineState && typeof engineState === "object" ? engineState : {};
  const connection = engineConnection && typeof engineConnection === "object" ? engineConnection : {};
  const engineInstalled = Boolean(
    (["deployed", "linked", "ready", "linking"].includes(String(state.state || "")) &&
      (state.projectId || state.deploymentId)) ||
    (connection.autoVerified === true &&
      connection.provenance === "inner-deployer-v1" &&
      connection.engineProjectId)
  );
  const installedAddonSet = new Set(Array.isArray(installedAddons) ? installedAddons : []);
  const components = requested.filter(component =>
    permitted.has(component) && (component === "base" ||
      (engineInstalled && (component === "engine-shared" || installedAddonSet.has(component))))
  );
  return {
    components,
    skippedComponents: requested.filter(component => !components.includes(component)),
    engineInstalled
  };
}
