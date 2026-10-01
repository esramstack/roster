/**
 * Timer engine — the single place elapsed time and durations are calculated.
 *
 * Source of truth is always persisted timestamps:
 *   active:    elapsed  = now      - startedAt
 *   completed: duration = endedAt  - startedAt
 * UI intervals only repaint; they never accumulate time.
 */
import type { CaseRecord, LivePhase, ProcedurePhaseTime } from "../types";

export type TimerState = "idle" | "active" | "done" | "invalid";

export interface Span {
  startMs: number | null;
  endMs: number | null;
  /** True when a time was reconstructed from a legacy "HH:MM" string (no date/seconds). */
  approx: boolean;
}

export const EMPTY_SPAN: Span = { startMs: null, endMs: null, approx: false };

const DAY = 86_400_000;

/** Parse an ISO timestamp; null for anything missing or invalid (never NaN). */
export function isoMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Interpret a legacy "HH:MM" as local time on the session date. */
export function legacyMs(hhmm: unknown, sessionDate: string): number | null {
  if (typeof hhmm !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sessionDate || "");
  if (!m || !d) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const ms = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, min, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** "HH:MM" local, used to keep the legacy fields in sync. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function phaseSpan(p: ProcedurePhaseTime | undefined, sessionDate: string): Span {
  if (!p) return EMPTY_SPAN;
  let approx = false;
  let startMs = isoMs(p.startedAt);
  if (startMs === null) {
    startMs = legacyMs(p.start, sessionDate);
    if (startMs !== null) approx = true;
  }
  let endMs = isoMs(p.endedAt);
  if (endMs === null) {
    endMs = legacyMs(p.end, sessionDate);
    if (endMs !== null) {
      approx = true;
      // Legacy clock strings have no date: an end earlier than start means it crossed midnight.
      if (startMs !== null && endMs < startMs) endMs += DAY;
    }
  }
  return { startMs, endMs, approx };
}

export function spanState(span: Span): TimerState {
  if (span.startMs === null) return span.endMs === null ? "idle" : "invalid";
  if (span.endMs === null) return "active";
  return span.endMs >= span.startMs ? "done" : "invalid";
}

/** Elapsed (active) or duration (done). Never negative, never NaN. */
export function spanMs(span: Span, now = Date.now()): number {
  if (span.startMs === null) return 0;
  const end = span.endMs ?? now;
  return Math.max(0, end - span.startMs);
}

export function casePhaseSpan(record: CaseRecord, phase: LivePhase, sessionDate: string): Span {
  return phaseSpan(record.procedure?.[phase], sessionDate);
}

/**
 * Overall case timer: from the first recorded phase start to the end of
 * Dressing (or of the last phase once the case is completed). Runs while the
 * case is in progress.
 */
export function caseSpan(record: CaseRecord, sessionDate: string): Span {
  const spans = (["anaesthesia", "extraction", "placing", "dressing"] as LivePhase[]).map((p) => casePhaseSpan(record, p, sessionDate));
  const starts = spans.map((s) => s.startMs).filter((v): v is number => v !== null);
  if (!starts.length) return EMPTY_SPAN;
  const startMs = Math.min(...starts);
  const approx = spans.some((s) => s.approx);
  const dressing = spans[3];
  const anyActive = spans.some((s) => spanState(s) === "active");
  let endMs: number | null = null;
  if (!anyActive && (spanState(dressing) === "done" || record.status === "completed")) {
    const ends = spans.map((s) => s.endMs).filter((v): v is number => v !== null);
    endMs = ends.length ? Math.max(...ends) : null;
  }
  return { startMs, endMs, approx };
}

// ── Formatting ────────────────────────────────────────────────

/** 01:34:22 — used for live counters. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 16 min · 1h 24m · 2h — used for completed durations. */
export function fmtDur(ms: number): string {
  const totalMin = Math.round(Math.max(0, ms) / 60000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** 09:18 local time. */
export function fmtTime(ms: number | null): string {
  if (ms === null) return "--:--";
  return hhmm(ms);
}

/** 09:18 – 10:42 */
export function fmtRange(span: Span): string {
  return `${fmtTime(span.startMs)} – ${span.endMs === null ? "now" : fmtTime(span.endMs)}`;
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Clock-string (HH:MM) → minutes since midnight; null if invalid. */
export function clockMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}
