import { admin } from "./db.ts";
import type { JsonRecord } from "./types.ts";

export async function writeAudit(
  actorId: string,
  sessionId: string,
  action: string,
  details: JsonRecord,
  entityType = "session",
  entityId?: string,
): Promise<void> {
  const { error } = await admin.from("audit_events").insert({
    actor_id: actorId,
    session_id: sessionId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    details,
  });
  if (error) console.error("audit write failed", error.message);
}
