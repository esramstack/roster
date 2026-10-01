/**
 * Phase timer state machine. All clinical timer mutations go through here so
 * the same validation applies everywhere (Live Floor, Roster, dialogs).
 */
import type { CaseRecord, LivePhase, Phase } from "../types";
import { casePhaseSpan, fmtTime, hhmm, spanState, toIso } from "./time";

export const PHASE_ORDER: LivePhase[] = ["anaesthesia", "extraction", "placing", "dressing"];
export const PHASE_LABEL: Record<LivePhase, string> = {
  anaesthesia: "Anaesthesia",
  extraction: "Extraction",
  placing: "Placing",
  dressing: "Dressing",
};
const NEXT: Record<LivePhase, Phase> = {
  anaesthesia: "extraction",
  extraction: "placing",
  placing: "dressing",
  dressing: "postOp",
};
const PHASE_RANK: Record<Phase, number> = {
  registration: 0,
  preOp: 1,
  anaesthesia: 2,
  extraction: 3,
  placing: 4,
  dressing: 5,
  postOp: 6,
};

/** Allow a little device clock drift when validating "not in the future". */
const FUTURE_TOLERANCE_MS = 60_000;

export type Check<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export function activePhases(record: CaseRecord, date: string): LivePhase[] {
  return PHASE_ORDER.filter((p) => spanState(casePhaseSpan(record, p, date)) === "active");
}

export function phaseState(record: CaseRecord, phase: LivePhase, date: string) {
  return spanState(casePhaseSpan(record, phase, date));
}

export interface StartPlan {
  /** A phase currently running that will be ended at the same instant. */
  endsActive: LivePhase | null;
  /** Non-blocking workflow notes shown in the confirmation. */
  warnings: string[];
}

export function checkStart(record: CaseRecord, phase: LivePhase, date: string, preOpDone: number, preOpTotal: number): Check<StartPlan> {
  const label = PHASE_LABEL[phase];
  if (record.status === "completed") return { ok: false, reason: "This case is already completed." };
  if (!record.patient?.name?.trim()) return { ok: false, reason: "Register a patient in this room before starting a phase." };
  const st = phaseState(record, phase, date);
  if (st === "active") return { ok: false, reason: `${label} is already running.` };
  if (st === "done") return { ok: false, reason: `${label} is already completed. Use “Edit times” to correct it.` };
  if (st === "invalid") return { ok: false, reason: `${label} has inconsistent times. Correct them with “Edit times” first.` };

  const running = activePhases(record, date).filter((p) => p !== phase);
  const endsActive = running[0] ?? null;
  const warnings: string[] = [];
  const idx = PHASE_ORDER.indexOf(phase);
  const skipped = PHASE_ORDER.slice(0, idx).filter((p) => phaseState(record, p, date) === "idle");
  if (skipped.length) warnings.push(`${skipped.map((p) => PHASE_LABEL[p]).join(", ")} ${skipped.length > 1 ? "have" : "has"} no recorded times.`);
  const later = PHASE_ORDER.slice(idx + 1).filter((p) => phaseState(record, p, date) !== "idle");
  if (later.length) warnings.push(`${PHASE_LABEL[later[0]]} has already been recorded; this starts ${label} out of order.`);
  if (phase === "anaesthesia" && preOpTotal > 0 && preOpDone < preOpTotal) {
    warnings.push(`Pre-op checklist is ${preOpDone} / ${preOpTotal}.`);
  }
  return { ok: true, endsActive, warnings };
}

export function applyStart(record: CaseRecord, phase: LivePhase, now: number, endsActive: LivePhase | null): void {
  if (endsActive) applyEndRaw(record, endsActive, now);
  const p = record.procedure[phase];
  p.startedAt = toIso(now);
  p.start = hhmm(now);
  delete p.endedAt;
  p.end = "";
  record.procedure.currentPhase = phase;
  record.status = "in-progress";
}

export function checkEnd(record: CaseRecord, phase: LivePhase, date: string, now: number): Check<{ startMs: number }> {
  const label = PHASE_LABEL[phase];
  const span = casePhaseSpan(record, phase, date);
  const st = spanState(span);
  if (st === "idle") return { ok: false, reason: `${label} hasn't started, so it can't be ended.` };
  if (st === "done") return { ok: false, reason: `${label} has already ended.` };
  if (st === "invalid" || span.startMs === null) return { ok: false, reason: `${label} has inconsistent times. Correct them with “Edit times”.` };
  if (now < span.startMs) {
    return { ok: false, reason: `This device's clock (${fmtTime(now)}) is earlier than the ${label} start (${fmtTime(span.startMs)}). Check the device time.` };
  }
  return { ok: true, startMs: span.startMs };
}

function applyEndRaw(record: CaseRecord, phase: LivePhase, now: number): void {
  const p = record.procedure[phase];
  p.endedAt = toIso(now);
  p.end = hhmm(now);
}

export function applyEnd(record: CaseRecord, phase: LivePhase, now: number): void {
  applyEndRaw(record, phase, now);
  const next = NEXT[phase];
  if (PHASE_RANK[record.procedure.currentPhase] <= PHASE_RANK[next]) record.procedure.currentPhase = next;
  if (record.status !== "completed") record.status = "in-progress";
}

/**
 * Manual correction of a phase's times. `endMs === null` leaves the phase running.
 * Rejects anything that would produce an invalid timeline.
 */
export function checkEdit(
  record: CaseRecord,
  phase: LivePhase,
  startMs: number | null,
  endMs: number | null,
  date: string,
  now: number,
): Check {
  const label = PHASE_LABEL[phase];
  if (startMs === null && endMs !== null) return { ok: false, reason: "An end time needs a start time." };
  if (startMs === null) return { ok: false, reason: `Enter a start time for ${label}.` };
  if (startMs > now + FUTURE_TOLERANCE_MS) return { ok: false, reason: "Start time can't be in the future." };
  if (endMs !== null && endMs > now + FUTURE_TOLERANCE_MS) return { ok: false, reason: "End time can't be in the future." };
  if (endMs !== null && endMs < startMs) return { ok: false, reason: "End time must be after the start time." };
  if (endMs === null) {
    const others = activePhases(record, date).filter((p) => p !== phase);
    if (others.length) return { ok: false, reason: `${PHASE_LABEL[others[0]]} is still running. Only one phase can be active at a time.` };
  }
  return { ok: true };
}

export function applyEdit(record: CaseRecord, phase: LivePhase, startMs: number, endMs: number | null): void {
  const p = record.procedure[phase];
  p.startedAt = toIso(startMs);
  p.start = hhmm(startMs);
  if (endMs === null) {
    delete p.endedAt;
    p.end = "";
  } else {
    p.endedAt = toIso(endMs);
    p.end = hhmm(endMs);
  }
  if (record.status === "scheduled") record.status = "in-progress";
}

/** Remove all times for a phase (deliberate correction only). */
export function applyClear(record: CaseRecord, phase: LivePhase): void {
  const p = record.procedure[phase];
  p.start = "";
  p.end = "";
  delete p.startedAt;
  delete p.endedAt;
}
