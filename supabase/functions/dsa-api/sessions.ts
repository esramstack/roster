import { writeAudit } from "./audit.ts";
import { admin } from "./db.ts";
import type { JsonRecord } from "./types.ts";
import { asObject, intFromKey } from "./utils.ts";
import { assertCaseKey, assertCaseStatus, assertDate, assertProcedureRoomKey, assertProcedureShape, assertRoomCount, assertRoomStatus } from "./validation.ts";

export async function ensureDailySession(date: string, actorId: string, seed: JsonRecord = {}) {
  assertDate(date);
  const roomCount = Number(seed.cc ?? seed.room_count ?? 4);
  assertRoomCount(roomCount);
  const { data: existing, error: readError } = await admin
    .from("daily_sessions")
    .select("*")
    .eq("session_date", date)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const { data, error } = await admin
    .from("daily_sessions")
    .insert({
      session_date: date,
      room_count: roomCount,
      lead: String(seed.lead ?? ""),
      config: asObject(seed.cfg ?? seed.config),
      created_by: actorId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export function mapCase(row: JsonRecord): JsonRecord {
  return {
    patient: row.patient ?? {},
    assessment: row.assessment ?? {},
    preOp: row.pre_op ?? {},
    procedure: row.procedure ?? {},
    postOp: row.post_op ?? {},
    teams: row.teams ?? {},
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    status: row.status ?? "scheduled",
  };
}

export function mapProcedureRoom(row: JsonRecord): JsonRecord {
  return {
    patient: row.patient ?? {},
    assignee: row.assignee ?? "",
    procedure: row.procedure ?? "",
    notes: row.notes ?? "",
    status: row.status ?? "available",
    queue: Array.isArray(row.queue) ? row.queue : [],
  };
}

export async function loadSession(date: string, actorId: string): Promise<JsonRecord> {
  assertDate(date);
  const session = await ensureDailySession(date, actorId);

  const [{ data: cases, error: casesError }, { data: procedureRooms, error: roomsError }] = await Promise.all([
    admin.from("cases").select("*").eq("session_id", session.id).order("room_number"),
    admin.from("procedure_rooms").select("*").eq("session_id", session.id).order("room_number"),
  ]);

  if (casesError) throw casesError;
  if (roomsError) throw roomsError;

  const C: Record<string, unknown> = {};
  for (const row of cases ?? []) {
    C[row.case_key] = mapCase(row);
  }

  const PR: Record<string, unknown> = {};
  for (const row of procedureRooms ?? []) {
    PR[row.room_key] = mapProcedureRoom(row);
  }

  return {
    id: session.id,
    date: session.session_date,
    cc: session.room_count,
    lead: session.lead,
    cfg: session.config ?? {},
    C,
    PR,
  };
}

export async function upsertSession(body: JsonRecord, actorId: string): Promise<JsonRecord> {
  const date = String(body.date ?? "");
  if (!date) throw new Error("date is required");
  assertDate(date);
  const roomCount = Number(body.cc ?? 4);
  assertRoomCount(roomCount);

  const { data: session, error: sessionError } = await admin
    .from("daily_sessions")
    .upsert({
      session_date: date,
      room_count: roomCount,
      lead: String(body.lead ?? ""),
      config: asObject(body.cfg),
      created_by: actorId,
    }, { onConflict: "session_date" })
    .select("*")
    .single();

  if (sessionError) throw sessionError;

  const cases = asObject(body.C);
  const caseRows = Object.entries(cases)
    .filter(([key]) => /^case[0-9]+$/.test(key))
    .map(([key, value]) => {
      assertCaseKey(key);
      const c = asObject(value);
      const procedure = asObject(c.procedure);
      const status = String(c.status ?? "scheduled");
      assertProcedureShape(procedure);
      assertCaseStatus(status);
      return {
        session_id: session.id,
        case_key: key,
        room_number: intFromKey(key, "case"),
        patient: asObject(c.patient),
        assessment: asObject(c.assessment),
        pre_op: asObject(c.preOp ?? c.pre_op),
        procedure,
        teams: asObject(c.teams),
        post_op: asObject(c.postOp ?? c.post_op),
        start_time: String(c.startTime ?? c.start_time ?? ""),
        end_time: String(c.endTime ?? c.end_time ?? ""),
        status,
      };
    });

  if (caseRows.length) {
    const { error } = await admin
      .from("cases")
      .upsert(caseRows, { onConflict: "session_id,case_key" });
    if (error) throw error;
  }

  const procedureRooms = asObject(body.PR);
  const roomRows = Object.entries(procedureRooms)
    .filter(([key]) => /^pr[0-9]+$/.test(key))
    .map(([key, value]) => {
      assertProcedureRoomKey(key);
      const room = asObject(value);
      const status = String(room.status ?? "available");
      assertRoomStatus(status);
      return {
        session_id: session.id,
        room_key: key,
        room_number: intFromKey(key, "pr"),
        patient: asObject(room.patient),
        assignee: String(room.assignee ?? ""),
        procedure: String(room.procedure ?? ""),
        notes: String(room.notes ?? ""),
        status,
        queue: Array.isArray(room.queue) ? room.queue : [],
      };
    });

  if (roomRows.length) {
    const { error } = await admin
      .from("procedure_rooms")
      .upsert(roomRows, { onConflict: "session_id,room_key" });
    if (error) throw error;
  }

  await writeAudit(actorId, session.id, "session_upsert", {
    date,
    caseCount: caseRows.length,
    procedureRoomCount: roomRows.length,
  });

  return loadSession(date, actorId);
}
