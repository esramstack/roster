import { writeAudit } from "./audit.ts";
import { admin } from "./db.ts";
import { ensureDailySession, mapProcedureRoom } from "./sessions.ts";
import type { JsonRecord } from "./types.ts";
import { asObject, deepMerge, isUuid } from "./utils.ts";
import { assertDate, assertRoomPatchKeys, assertRoomStatus } from "./validation.ts";

export async function patchProcedureRoom(idOrKey: string, date: string, patch: JsonRecord, actorId: string): Promise<JsonRecord> {
  if (!date && !isUuid(idOrKey)) throw new Error("date is required when patching by room key");
  if (date) assertDate(date);
  assertRoomPatchKeys(patch);

  let query = admin.from("procedure_rooms").select("*");
  if (isUuid(idOrKey)) {
    query = query.eq("id", idOrKey);
  } else {
    const session = await ensureDailySession(date, actorId);
    query = query.eq("session_id", session.id).eq("room_key", idOrKey);
  }

  const { data: current, error: readError } = await query.single();
  if (readError) throw readError;

  const update: JsonRecord = {};
  if (patch.patient) update.patient = deepMerge(asObject(current.patient), asObject(patch.patient));
  for (const key of ["assignee", "procedure", "notes", "status"]) {
    if (patch[key] !== undefined) update[key] = String(patch[key]);
  }
  if (patch.queue !== undefined) update.queue = Array.isArray(patch.queue) ? patch.queue : [];
  if (update.status) assertRoomStatus(String(update.status));

  const { data, error } = await admin
    .from("procedure_rooms")
    .update(update)
    .eq("id", current.id)
    .select("*")
    .single();

  if (error) throw error;
  await writeAudit(actorId, current.session_id, "procedure_room_patch", patch, "procedure_room", current.id);
  return mapProcedureRoom(data);
}
