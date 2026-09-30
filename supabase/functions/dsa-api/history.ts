import { admin } from "./db.ts";
import { loadSession } from "./sessions.ts";
import type { JsonRecord } from "./types.ts";
import { asObject } from "./utils.ts";

function graftsFromProcedure(procedure: JsonRecord): number {
  const extraction = asObject(procedure.extraction);
  return Number(extraction.grafts || 0);
}

export async function history(actorId: string, date?: string | null): Promise<JsonRecord> {
  if (date) {
    return { session: await loadSession(date, actorId) };
  }

  const { data: sessions, error } = await admin
    .from("daily_sessions")
    .select("id, session_date, lead, room_count, config")
    .order("session_date", { ascending: false })
    .limit(40);

  if (error) throw error;
  if (!sessions?.length) return { sessions: [] };

  const sessionIds = sessions.map((session) => session.id);
  const [{ data: cases, error: casesError }, { data: rooms, error: roomsError }] = await Promise.all([
    admin
      .from("cases")
      .select("session_id, case_key, status, procedure, patient, assessment")
      .in("session_id", sessionIds),
    admin
      .from("procedure_rooms")
      .select("session_id, room_key, status, patient, procedure, queue")
      .in("session_id", sessionIds),
  ]);

  if (casesError) throw casesError;
  if (roomsError) throw roomsError;

  const casesBySession = new Map<string, JsonRecord[]>();
  for (const row of cases ?? []) {
    const list = casesBySession.get(row.session_id) ?? [];
    list.push(row);
    casesBySession.set(row.session_id, list);
  }

  const roomsBySession = new Map<string, JsonRecord[]>();
  for (const row of rooms ?? []) {
    const list = roomsBySession.get(row.session_id) ?? [];
    list.push(row);
    roomsBySession.set(row.session_id, list);
  }

  return {
    sessions: sessions.map((session) => {
      const config = asObject(session.config);
      const archived = Array.isArray(config.completedCases) ? config.completedCases : [];
      const sessionCases = casesBySession.get(session.id) ?? [];
      const sessionRooms = roomsBySession.get(session.id) ?? [];

      const C: Record<string, unknown> = {};
      for (const row of sessionCases) {
        C[String(row.case_key)] = {
          patient: row.patient ?? {},
          assessment: row.assessment ?? {},
          preOp: {},
          procedure: row.procedure ?? {},
          postOp: {},
          teams: {},
          startTime: "",
          endTime: "",
          status: row.status ?? "scheduled",
        };
      }

      const PR: Record<string, unknown> = {};
      for (const row of sessionRooms) {
        PR[String(row.room_key)] = {
          patient: row.patient ?? {},
          assignee: "",
          procedure: row.procedure ?? "",
          notes: "",
          status: row.status ?? "available",
          queue: Array.isArray(row.queue) ? row.queue : [],
        };
      }

      const activeGrafts = sessionCases.reduce((sum, row) => sum + graftsFromProcedure(asObject(row.procedure)), 0);
      const archivedGrafts = archived.reduce((sum: number, entry: JsonRecord) => {
        const record = asObject(entry.record);
        return sum + graftsFromProcedure(asObject(record.procedure));
      }, 0);

      return {
        id: session.id,
        date: session.session_date,
        cc: session.room_count,
        lead: session.lead ?? "",
        cfg: config,
        C,
        PR,
        summary: {
          caseCount: sessionCases.length + archived.length,
          doneCount: sessionCases.filter((row) => row.status === "completed").length + archived.length,
          grafts: activeGrafts + archivedGrafts,
        },
      };
    }),
  };
}
