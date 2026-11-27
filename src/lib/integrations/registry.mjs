export const BUILTIN_INTEGRATIONS = Object.freeze([
  Object.freeze({
    id: "mail",
    name: "Mail System",
    description: "Billing Store mail configuration, templates, sender routing, event triggers and Remote Staff delegation.",
    version: "2.0.0",
    publisher: "OrbitFS",
    distribution: "bundled",
    installable: true,
    sourceRepository: "remipetrovich-design/Mail-system",
    sourcePath: "mail-configuration-module/Billing",
    sourceWorkspaceBuildOnly: true,
    hostAdapted: true,
    requiredEnvironment: ["MAIL_SYSTEM_URL", "MAIL_SYSTEM_API_KEY"],
    features: [
      "template-management",
      "template-preview",
      "variable-discovery",
      "event-triggers",
      "conditional-sender-routing",
      "scoped-api-key-capabilities",
      "application-enable-disable",
      "theme-customization",
      "remote-staff-provisioning",
      "employment-lifecycle-sync",
      "remote-user-session-exchange"
    ],
    route: "/admin/integrations/mail"
  })
]);

export function getBuiltinIntegration(id) {
  return BUILTIN_INTEGRATIONS.find((item) => item.id === id) || null;
}

export function validateBuiltinIntegration(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  const trusted = getBuiltinIntegration(manifest.id);
  if (!trusted) return false;
  return manifest.publisher === trusted.publisher
    && manifest.version === trusted.version
    && manifest.sourceRepository === trusted.sourceRepository
    && manifest.sourcePath === trusted.sourcePath
    && manifest.distribution === "bundled"
    && manifest.hostAdapted === true;
}

export function canRunIntegration(state) {
  return state?.installed === true && state?.enabled === true;
}
