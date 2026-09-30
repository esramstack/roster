import { writeAudit } from "./audit.ts";
import { admin } from "./db.ts";
import { ensureDailySession, mapCase } from "./sessions.ts";
import type { JsonRecord } from "./types.ts";
import { asObject, deepMerge, isUuid } from "./utils.ts";
import { assertCasePatchKeys, assertCaseStatus, assertDate, assertProcedureShape } from "./validation.ts";

export async function patchCase(idOrKey: string, date: string, patch: JsonRecord, actorId: string): Promise<JsonRecord> {
  if (!date && !isUuid(idOrKey)) throw new Error("date is required when patching by case key");
  if (date) assertDate(date);
  assertCasePatchKeys(patch);

  let query = admin.from("cases").select("*");
  if (isUuid(idOrKey)) {
    query = query.eq("id", idOrKey);
  } else {
    const session = await ensureDailySession(date, actorId);
    query = query.eq("session_id", session.id).eq("case_key", idOrKey);
  }

  const { data: current, error: readError } = await query.single();
  if (readError) throw readError;

  const update: JsonRecord = {};
  for (const key of ["patient", "assessment", "procedure", "teams"]) {
    if (patch[key]) update[key] = deepMerge(asObject(current[key]), asObject(patch[key]));
  }
  if (update.procedure) assertProcedureShape(asObject(update.procedure));
  if (patch.preOp || patch.pre_op) update.pre_op = deepMerge(asObject(current.pre_op), asObject(patch.preOp ?? patch.pre_op));
  if (patch.postOp || patch.post_op) update.post_op = deepMerge(asObject(current.post_op), asObject(patch.postOp ?? patch.post_op));
  if (patch.startTime ?? patch.start_time) update.start_time = String(patch.startTime ?? patch.start_time);
  if (patch.endTime ?? patch.end_time) update.end_time = String(patch.endTime ?? patch.end_time);
  if (patch.status) {
    update.status = String(patch.status);
    assertCaseStatus(String(update.status));
  }

  const { data, error } = await admin
    .from("cases")
    .update(update)
    .eq("id", current.id)
    .select("*")
    .single();

  if (error) throw error;
  await writeAudit(actorId, current.session_id, "case_patch", patch, "case", current.id);
  return mapCase(data);
}
