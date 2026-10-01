/**
 * Read-only derivations used by every view: stage, journey, grafts, metrics,
 * alerts and staffing. Everything here comes from data already in the model —
 * no invented clinical rules or thresholds.
 */
import { caseIndex, caseKeys, LIVE_PHASES, PHASE_TEAMS, preOpCount, procRoomKeys, roomName, state, TD, today } from "../state";
import type { CaseRecord, LivePhase } from "../types";
import { caseSpan, casePhaseSpan, clockMinutes, fmtDur, fmtTime, type Span, spanMs, spanState, type TimerState } from "./time";
import { PHASE_LABEL } from "./timers";

export type Stage = "empty" | "preOp" | LivePhase | "postOp" | "completed";
export type Tone = "neutral" | "info" | "active" | "attention" | "success" | "danger";

export interface GraftStats {
  estimate: number;
  extracted: number;
  placed: number;
  hairline: number;
  middle: number;
  crown: number;
  /** Extracted but not yet placed. */
  toPlace: number;
  /** Estimate minus extracted (0 when no estimate). */
  toExtract: number;
}

export interface CaseView {
  key: string;
  index: number;
  room: string;
  record: CaseRecord;
  registered: boolean;
  stage: Stage;
  /** True when between phases (previous ended, next not started). */
  waiting: boolean;
  active: LivePhase | null;
  next: LivePhase | null;
  spans: Record<LivePhase, Span>;
  states: Record<LivePhase, TimerState>;
  total: Span;
  grafts: GraftStats;
  preOp: { done: number; total: number };
}

export function n(value: unknown): number {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function graftStats(record: CaseRecord): GraftStats {
  const estimate = n(record.assessment?.graftEstimate);
  const extracted = n(record.procedure?.extraction?.grafts);
  const hairline = n(record.procedure?.placing?.hairline);
  const middle = n(record.procedure?.placing?.middle);
  const crown = n(record.procedure?.placing?.crown);
  const placed = hairline + middle + crown;
  return {
    estimate,
    extracted,
    placed,
    hairline,
    middle,
    crown,
    toPlace: Math.max(0, extracted - placed),
    toExtract: estimate ? Math.max(0, estimate - extracted) : 0,
  };
}

export function caseView(key: string, record: CaseRecord = state.C[key], date = state.sessionDate, checks = state.cfg.checks): CaseView {
  const index = caseIndex(key);
  const registered = Boolean(record?.patient?.name?.trim());
  const spans = {} as Record<LivePhase, Span>;
  const states = {} as Record<LivePhase, TimerState>;
  for (const p of LIVE_PHASES) {
    spans[p] = casePhaseSpan(record, p, date);
    states[p] = spanState(spans[p]);
  }
  const active = LIVE_PHASES.find((p) => states[p] === "active") ?? null;
  const anyRecorded = LIVE_PHASES.some((p) => states[p] !== "idle");
  // The next phase is the first unrecorded one after the latest recorded phase (skipped phases stay skipped).
  let lastRecorded = -1;
  LIVE_PHASES.forEach((p, i) => {
    if (states[p] !== "idle") lastRecorded = i;
  });
  const next = LIVE_PHASES.slice(lastRecorded + 1).find((p) => states[p] === "idle") ?? null;

  let stage: Stage = "empty";
  let waiting = false;
  if (record?.status === "completed") stage = "completed";
  else if (!registered && !anyRecorded) stage = "empty";
  else if (active) stage = active;
  else if (states.dressing === "done") stage = "postOp";
  else if (anyRecorded && next) {
    stage = next;
    waiting = true;
  } else stage = "preOp";

  return {
    key,
    index,
    room: roomName(index),
    record,
    registered,
    stage,
    waiting,
    active,
    next,
    spans,
    states,
    total: caseSpan(record, date),
    grafts: graftStats(record),
    preOp: { done: preOpCount(record, checks), total: checks.length },
  };
}

export function allCaseViews(): CaseView[] {
  return caseKeys()
    .filter((key) => state.C[key])
    .map((key) => caseView(key));
}

export function stageLabel(v: CaseView): string {
  switch (v.stage) {
    case "empty":
      return "Empty";
    case "preOp":
      return v.preOp.total && v.preOp.done >= v.preOp.total ? "Ready" : "Pre-Op";
    case "postOp":
      return "Post-Op";
    case "completed":
      return "Completed";
    default:
      return v.waiting ? `Awaiting ${PHASE_LABEL[v.stage]}` : PHASE_LABEL[v.stage];
  }
}

export function stageTone(v: CaseView): Tone {
  if (v.stage === "empty") return "neutral";
  if (v.stage === "completed") return "success";
  if (v.stage === "postOp") return "info";
  if (v.active) return "active";
  if (v.waiting) return "attention";
  return "neutral";
}

export type StepState = "done" | "current" | "live" | "todo";
export interface JourneyStep {
  key: string;
  label: string;
  short: string;
  state: StepState;
}

/** Registration → Pre-Op → Anaesthesia → Extraction → Placing → Dressing → Post-Op → Completed */
export function journey(v: CaseView): JourneyStep[] {
  const started = LIVE_PHASES.some((p) => v.states[p] !== "idle");
  const preOpDone = started || (v.preOp.total > 0 && v.preOp.done >= v.preOp.total);
  const completed = v.stage === "completed";
  const steps: JourneyStep[] = [
    { key: "registration", label: "Registration", short: "Reg", state: v.registered || completed ? "done" : "current" },
    { key: "preOp", label: "Pre-Op", short: "Pre", state: preOpDone || completed ? "done" : v.registered ? "current" : "todo" },
  ];
  for (const p of LIVE_PHASES) {
    const st = v.states[p];
    steps.push({
      key: p,
      label: PHASE_LABEL[p],
      short: PHASE_LABEL[p].slice(0, 3),
      state: st === "active" ? "live" : st === "done" ? "done" : v.stage === p ? "current" : completed && st !== "idle" ? "done" : "todo",
    });
  }
  steps.push({ key: "postOp", label: "Post-Op", short: "Post", state: completed ? "done" : v.stage === "postOp" ? "current" : "todo" });
  steps.push({ key: "completed", label: "Completed", short: "Done", state: completed ? "done" : "todo" });
  return steps;
}

/** Fraction of the 8-step journey complete, for compact progress bars. */
export function journeyProgress(v: CaseView): number {
  const steps = journey(v);
  const done = steps.filter((s) => s.state === "done").length + steps.filter((s) => s.state === "live").length * 0.5;
  return Math.min(1, done / steps.length);
}

/** Staff working in the phase that is live now (or next up). */
export function currentTeam(v: CaseView): Array<{ name: string; role: string }> {
  const phase = v.active ?? (v.waiting ? v.next : null);
  if (!phase) return [];
  const out: Array<{ name: string; role: string }> = [];
  for (const teamKey of PHASE_TEAMS[phase]) {
    const def = TD.find((t) => t.k === teamKey);
    const rows = v.record.teams?.[teamKey] || {};
    for (const row of def?.r || []) {
      for (const name of rows[row.k] || []) {
        out.push({ name, role: def && def.r.length > 1 ? `${def.l} · ${row.l}` : def?.l || teamKey });
      }
    }
  }
  return out;
}

export interface Assignment {
  roomIndex: number;
  roomKey: string;
  team: string;
  row: string;
  live: boolean;
}

/** Every staff assignment across today's occupied OT rooms, keyed by name. */
export function staffAssignments(): Map<string, Assignment[]> {
  const map = new Map<string, Assignment[]>();
  for (const v of allCaseViews()) {
    if (!v.registered || v.stage === "completed") continue;
    const liveTeams = v.active ? PHASE_TEAMS[v.active] : [];
    for (const def of TD) {
      const rows = v.record.teams?.[def.k] || {};
      for (const row of def.r) {
        for (const name of rows[row.k] || []) {
          const list = map.get(name) ?? [];
          list.push({ roomIndex: v.index, roomKey: v.key, team: def.l, row: row.l, live: liveTeams.includes(def.k) });
          map.set(name, list);
        }
      }
    }
  }
  return map;
}

// ── Metrics ───────────────────────────────────────────────────

export interface FloorMetrics {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  roomsAvailable: number;
  roomsOccupied: number;
  estimate: number;
  extracted: number;
  placed: number;
  queue: number;
  prOccupied: number;
  attention: number;
}

export function floorMetrics(views = allCaseViews(), alerts = floorAlerts(views)): FloorMetrics {
  const archived = state.cfg.completedCases || [];
  const m: FloorMetrics = {
    total: archived.length,
    scheduled: 0,
    inProgress: 0,
    completed: archived.length,
    roomsAvailable: 0,
    roomsOccupied: 0,
    estimate: 0,
    extracted: 0,
    placed: 0,
    queue: 0,
    prOccupied: 0,
    attention: alerts.filter((a) => a.level !== "info").length,
  };
  for (const entry of archived) {
    const g = graftStats(entry.record);
    m.estimate += g.estimate;
    m.extracted += g.extracted;
    m.placed += g.placed;
  }
  for (const v of views) {
    if (v.stage === "empty") {
      m.roomsAvailable += 1;
      continue;
    }
    m.roomsOccupied += 1;
    m.total += 1;
    if (v.stage === "completed") m.completed += 1;
    else if (v.stage === "preOp") m.scheduled += 1;
    else m.inProgress += 1;
    m.estimate += v.grafts.estimate;
    m.extracted += v.grafts.extracted;
    m.placed += v.grafts.placed;
  }
  for (const key of procRoomKeys()) {
    const room = state.PR[key];
    if (!room) continue;
    m.queue += room.queue?.length || 0;
    if (room.status === "occupied") m.prOccupied += 1;
  }
  return m;
}

// ── Alerts ────────────────────────────────────────────────────

export interface Alert {
  level: "critical" | "warn" | "info";
  caseKey: string;
  roomIndex: number;
  title: string;
  detail: string;
  /** Roster tab that resolves it. */
  tab: "patient" | "preop" | "teams" | "procedure" | "postop";
}

export function caseAlerts(v: CaseView, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  if (!v.registered || v.stage === "completed") return out;
  const base = { caseKey: v.key, roomIndex: v.index };
  const isToday = state.sessionDate === today();
  const started = LIVE_PHASES.some((p) => v.states[p] !== "idle");

  for (const p of LIVE_PHASES) {
    if (v.states[p] === "invalid") {
      out.push({ ...base, level: "critical", tab: "procedure", title: `${PHASE_LABEL[p]} times inconsistent`, detail: "End is recorded without a valid start. Correct the times." });
    }
  }
  const activeCount = LIVE_PHASES.filter((p) => v.states[p] === "active").length;
  if (activeCount > 1) {
    out.push({ ...base, level: "warn", tab: "procedure", title: "More than one phase running", detail: "End the phase that has finished." });
  }

  const g = v.grafts;
  if (g.placed > g.extracted) {
    out.push({ ...base, level: "critical", tab: "procedure", title: "Placed exceeds extracted", detail: `${g.placed.toLocaleString()} placed vs ${g.extracted.toLocaleString()} extracted.` });
  } else if (v.states.placing === "done" && g.extracted > 0 && g.placed < g.extracted) {
    out.push({ ...base, level: "warn", tab: "procedure", title: "Graft count discrepancy", detail: `Placing ended with ${g.toPlace.toLocaleString()} extracted grafts not recorded as placed.` });
  }

  if (v.preOp.total && v.preOp.done < v.preOp.total) {
    out.push({
      ...base,
      level: started ? "warn" : "info",
      tab: "preop",
      title: started ? "Started with pre-op incomplete" : "Pre-op checklist incomplete",
      detail: `${v.preOp.done} / ${v.preOp.total} items complete.`,
    });
  }

  const teamPhase = v.active ?? v.next;
  if (teamPhase && v.stage !== "postOp") {
    const empty = PHASE_TEAMS[teamPhase].every((teamKey) => Object.values(v.record.teams?.[teamKey] || {}).every((list) => !list?.length));
    if (empty) {
      out.push({ ...base, level: v.active ? "warn" : "info", tab: "teams", title: `No ${PHASE_LABEL[teamPhase]} team assigned`, detail: v.active ? "Phase is running without an assigned team." : "Assign staff before this phase starts." });
    }
  }

  if (isToday) {
    const d = new Date(now);
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const startMin = clockMinutes(v.record.startTime);
    if (!started && startMin !== null && nowMin > startMin) {
      out.push({ ...base, level: "warn", tab: "procedure", title: "Not started", detail: `Scheduled ${v.record.startTime} · ${fmtDur((nowMin - startMin) * 60000)} past.` });
    }
    const endMin = clockMinutes(v.record.endTime);
    if (started && endMin !== null && nowMin > endMin && v.stage !== "postOp") {
      out.push({ ...base, level: "warn", tab: "procedure", title: "Past scheduled end", detail: `Scheduled to finish ${v.record.endTime}.` });
    }
  }

  if (v.states.extraction === "done" && v.states.placing === "idle") {
    const since = v.spans.extraction.endMs;
    out.push({ ...base, level: "info", tab: "procedure", title: "Extraction complete, placing not started", detail: since ? `Extraction ended ${fmtTime(since)} · ${fmtDur(now - since)} ago.` : "Extraction has ended." });
  }

  if (v.stage === "postOp") {
    const missing: string[] = [];
    if (!v.record.postOp?.prescriptions) missing.push("prescriptions");
    if (!v.record.postOp?.followUpDate) missing.push("follow-up date");
    if (missing.length) out.push({ ...base, level: "info", tab: "postop", title: "Discharge information missing", detail: `Add ${missing.join(" and ")}.` });
  }
  return out;
}

const LEVEL_RANK = { critical: 0, warn: 1, info: 2 } as const;

export function floorAlerts(views = allCaseViews(), now = Date.now()): Alert[] {
  return views.flatMap((v) => caseAlerts(v, now)).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.roomIndex - b.roomIndex);
}

export function elapsedLabel(span: Span, now = Date.now()): string {
  return fmtDur(spanMs(span, now));
}
