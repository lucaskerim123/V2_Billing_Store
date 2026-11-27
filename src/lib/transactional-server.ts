/**
 * Legacy mail automation compatibility shim.
 * Delivery, templates, and queued automations have been retired.
 * Callers may continue their primary business operation without attempting email.
 */
export async function sendAutomation(
  _eventKey: string,
  _to: string,
  _vars: Record<string, string>,
  _relatedType?: string,
  _relatedId?: string,
) {
  return { ok: true, skipped: true, reason: "mail_system_retired" as const };
}
