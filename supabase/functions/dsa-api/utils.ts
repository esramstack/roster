import type { JsonRecord } from "./types.ts";

export function cleanPath(pathname: string): string {
  return pathname.replace(/^\/dsa-api/, "") || "/";
}

export function intFromKey(key: string, prefix: string): number {
  const value = Number(key.replace(prefix, ""));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

export function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function deepMerge(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key] as JsonRecord, value as JsonRecord);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function readBody(req: Request): Promise<JsonRecord> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return asObject(JSON.parse(raw));
  } catch {
    throw new Error("Invalid JSON body");
  }
}
