import type { MailRoute } from "./types";

function readPath(context: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, context);
}

function matches(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return actual === expected;
  }

  const condition = expected as Record<string, unknown>;
  const operators = Object.keys(condition);
  if (!operators.length || operators.some((key) => !["equals", "notEquals", "in", "contains"].includes(key))) {
    throw new Error("Route conditions support equals, notEquals, in and contains only.");
  }

  if ("equals" in condition && actual !== condition.equals) return false;
  if ("notEquals" in condition && actual === condition.notEquals) return false;
  if ("in" in condition) {
    if (!Array.isArray(condition.in) || !condition.in.includes(actual)) return false;
  }
  if ("contains" in condition) {
    if (typeof actual !== "string" || typeof condition.contains !== "string" || !actual.includes(condition.contains)) return false;
  }
  return true;
}

export function resolveMailRoute(
  routes: MailRoute[],
  context: Record<string, unknown>,
  fallbackSender?: string | null,
) {
  const ordered = [...routes].filter((route) => route.active).sort((a, b) => b.priority - a.priority);
  for (const route of ordered) {
    const matched = Object.entries(route.conditions || {}).every(([path, expected]) =>
      matches(readPath(context, path), expected),
    );
    if (matched) return { route, sender: route.sender_address };
  }
  return { route: null, sender: fallbackSender || null };
}
