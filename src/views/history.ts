/** History — searchable surgical sessions with read-only case summaries. */
import { caseView, graftStats } from "../core/derive";
import { fmtDur, fmtTime, isoMs } from "../core/time";
import { normalizeCase, normalizeConfig, state, TD, today } from "../state";
import type { CaseRecord, LoadedSession, ProcedureRoom } from "../types";
import { avatar, badge, durationCell, emptyState, skeleton } from "../ui/components";
import { E, fmtDateLong, fmtDateShort, plural } from "../ui/dom";
import { icon } from "../ui/icons";
import { durationSummary, graftPanel, phaseTimeline } from "./procedure";

export const historyFilter = { q: "", from: "", to: "", procedure: "", room: "", status: "" };

export type HistStatus = "completed" | "in-progress" | "scheduled";

export interface HistEntry {
  date: string;
  lead: string;
  ref: string;
  kind: "case" | "archive" | "pr" | "prArchive";
  room: string;
  patient: string;
  contact: string;
  procedure: string;
  status: HistStatus;
  record?: CaseRecord;
  pr?: Omit<ProcedureRoom, "queue">;
  dischargedAt?: string;
}

function caseStatus(record: CaseRecord, date: string, archived: boolean): HistStatus {
  if (archived || record.status === "completed") return "completed";
  const v = caseView("x1", record, date, []);
  return Object.values(v.states).some((s) => s !== "idle") ? "in-progress" : "scheduled";
}

export function sessionEntries(session: LoadedSession): HistEntry[] {
  const cfg = normalizeConfig(session.cfg);
  const out: HistEntry[] = [];
  const base = { date: session.date, lead: session.lead || "" };
  for (const [key, raw] of Object.entries(session.C || {})) {
    const record = normalizeCase(raw, cfg);
    if (!record.patient.name?.trim()) continue;
    const i = Number(key.replace("case", "")) || 1;
    out.push({ ...base, ref: `c:${key}`, kind: "case", room: cfg.rooms[i - 1] || `OT Room ${i}`, patient: record.patient.name, contact: record.patient.contact, procedure: record.assessment.procedureType, status: caseStatus(record, session.date, false), record });
  }
  (cfg.completedCases || []).forEach((entry, i) => {
    const record = normalizeCase(entry.record, cfg);
    out.push({ ...base, ref: `a:${i}`, kind: "archive", room: entry.roomName || entry.roomKey, patient: record.patient.name, contact: record.patient.contact, procedure: record.assessment.procedureType, status: "completed", record, dischargedAt: entry.dischargedAt });
  });
  (cfg.completedProcedureRooms || []).forEach((entry, i) => {
    out.push({ ...base, ref: `pa:${i}`, kind: "prArchive", room: entry.roomName, patient: entry.room.patient?.name || "", contact: entry.room.patient?.contact || "", procedure: entry.room.procedure, status: "completed", pr: entry.room });
  });
  for (const [key, room] of Object.entries(session.PR || {})) {
    if (!room?.patient?.name) continue;
    const i = Number(key.replace("pr", "")) || 1;
    out.push({ ...base, ref: `p:${key}`, kind: "pr", room: cfg.procRooms[i - 1] || `Procedure Room ${i}`, patient: room.patient.name, contact: room.patient.contact, procedure: room.procedure, status: room.status === "completed" ? "completed" : room.patient.startedAt || room.status === "occupied" ? "in-progress" : "scheduled", pr: room });
  }
  return out;
}

function matches(e: HistEntry): boolean {
  const f = historyFilter;
  if (f.from && e.date < f.from) return false;
  if (f.to && e.date > f.to) return false;
  if (f.procedure && e.procedure !== f.procedure) return false;
  if (f.room && e.room !== f.room) return false;
  if (f.status && e.status !== f.status) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${e.patient} ${e.contact} ${e.lead}`.toLowerCase().includes(q)) return false;
  return true;
}

const STATUS_BADGE: Record<HistStatus, [string, "success" | "active" | "neutral"]> = {
  completed: ["Completed", "success"],
  "in-progress": ["Not closed", "active"],
  scheduled: ["Not started", "neutral"],
};

function statusBadge(e: HistEntry): string {
  const [label, tone] = STATUS_BADGE[e.status];
  return badge(e.status === "in-progress" && e.date === today() ? "In progress" : label, tone);
}

function entryRow(e: HistEntry): string {
  let duration = `<span class="muted">—</span>`;
  let grafts = `<span class="muted">—</span>`;
  if (e.record) {
    const v = caseView("x1", e.record, e.date, []);
    duration = durationCell(v.total, true);
    const g = graftStats(e.record);
    grafts = g.extracted || g.placed ? `<span class="num">${g.extracted.toLocaleString()} / ${g.placed.toLocaleString()}</span>` : grafts;
  } else if (e.pr) {
    const s = isoMs(e.pr.patient?.startedAt);
    const en = isoMs(e.pr.patient?.endedAt);
    duration = s !== null && en !== null ? `<span class="num">${fmtDur(en - s)}</span>` : duration;
  }
  return `<tr class="h-row" tabindex="0" role="button" onclick="void dsa.openHistoryCase('${e.date}','${e.ref}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
    <td><span class="h-room">${E(e.room)}</span>${e.kind === "pr" || e.kind === "prArchive" ? `<span class="tag">PR</span>` : ""}</td>
    <td><strong>${E(e.patient || "—")}</strong></td>
    <td>${E(e.procedure || "—")}</td>
    <td>${statusBadge(e)}</td>
    <td>${duration}</td>
    <td class="hide-sm">${grafts}</td>
    <td class="chev-cell">${icon("chevronRight")}</td>
  </tr>`;
}

function filterBar(rooms: string[], procedures: string[]): string {
  const f = historyFilter;
  const sel = (name: keyof typeof historyFilter, label: string, opts: Array<[string, string]>) =>
    `<label class="hf"><span class="sr-only">${label}</span><select onchange="dsa.setHistoryFilter('${name}',this.value)" aria-label="${label}"><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${E(v)}" ${f[name] === v ? "selected" : ""}>${E(l)}</option>`).join("")}</select></label>`;
  const active = Object.values(f).some(Boolean);
  return `<div class="history-filters">
    <label class="hf search">${icon("search")}<input type="search" id="histSearch" value="${E(f.q)}" placeholder="Search patient, contact or lead" oninput="dsa.setHistoryFilter('q',this.value)" aria-label="Search history"></label>
    <label class="hf date"><span>From</span><input type="date" value="${E(f.from)}" onchange="dsa.setHistoryFilter('from',this.value)" aria-label="From date"></label>
    <label class="hf date"><span>To</span><input type="date" value="${E(f.to)}" onchange="dsa.setHistoryFilter('to',this.value)" aria-label="To date"></label>
    ${sel("procedure", "All procedures", procedures.map((p) => [p, p]))}
    ${sel("room", "All rooms", rooms.map((r) => [r, r]))}
    ${sel("status", "Any status", [["completed", "Completed"], ["in-progress", "Not closed"], ["scheduled", "Not started"]])}
    ${active ? `<button type="button" class="btn ghost sm" onclick="dsa.clearHistoryFilters()">Clear</button>` : ""}
    <button type="button" class="icon-btn" onclick="void dsa.refreshHistory()" title="Refresh" aria-label="Refresh history">${icon("refresh")}</button>
  </div>`;
}

export function renderHistory(): string {
  if (state.historyLoading && !state.historyRows.length) {
    return `<div class="page">${filterBar([], [])}<div class="panel"><div class="panel-body">${skeleton(6)}</div></div></div>`;
  }
  if (state.historyError && !state.historyRows.length) {
    return `<div class="page">${emptyState({ icon: "alert", title: "Couldn't load history", body: state.historyError, action: `<button type="button" class="btn primary" onclick="void dsa.refreshHistory()">Try again</button>` })}</div>`;
  }
  const all = state.historyRows.flatMap((s) => sessionEntries(s));
  const rooms = [...new Set(all.map((e) => e.room))].sort();
  const procedures = [...new Set(all.map((e) => e.procedure).filter(Boolean))].sort();
  const filtered = all.filter(matches);
  const filtering = Object.values(historyFilter).some(Boolean);

  const groups = state.historyRows
    .map((session) => {
      const rows = filtered.filter((e) => e.date === session.date);
      if (!rows.length && filtering) return "";
      const entries = sessionEntries(session);
      const cases = entries.filter((e) => e.record);
      const grafts = cases.reduce((sum, e) => sum + graftStats(e.record!).extracted, 0);
      const done = cases.filter((e) => e.status === "completed").length;
      return `<section class="h-session">
        <header class="h-session-head">
          <div>
            <h3>${E(fmtDateLong(session.date))}</h3>
            <p class="muted small">${session.lead ? `Lead ${E(session.lead)} · ` : ""}${plural(cases.length, "HT case")} · ${done} completed · ${grafts.toLocaleString()} grafts</p>
          </div>
          <button type="button" class="btn ghost sm" onclick="void dsa.openHistorySession('${session.date}')">${icon("external")} Open session</button>
        </header>
        ${rows.length ? `<table class="table h-table"><colgroup><col style="width:19%"><col style="width:22%"><col style="width:17%"><col style="width:13%"><col style="width:12%"><col class="hide-sm" style="width:14%"><col style="width:40px"></colgroup><thead><tr><th>Room</th><th>Patient</th><th>Procedure</th><th>Status</th><th>Duration</th><th class="hide-sm">Grafts ext / placed</th><th></th></tr></thead><tbody>${rows.map(entryRow).join("")}</tbody></table>` : `<p class="h-none muted small">No patients recorded.</p>`}
      </section>`;
    })
    .join("");

  return `<div class="page">
    ${filterBar(rooms, procedures)}
    <p class="muted small h-count">${filtering ? `${plural(filtered.length, "record")} match` : `${plural(state.historyRows.length, "session")} · most recent 40`}${state.historyLoading ? " · refreshing…" : ""}</p>
    ${groups || emptyState({ icon: filtering ? "filter" : "hist", title: filtering ? "No matching records" : "No sessions yet", body: filtering ? "Try a different search or clear the filters." : "Saved clinical days appear here." })}
  </div>`;
}

// ── Read-only case summary ───────────────────────────────────

function kv(label: string, value: unknown): string {
  const text = value === undefined || value === null || value === "" ? "—" : String(value);
  return `<div class="kv"><span>${E(label)}</span><strong>${E(text)}</strong></div>`;
}

export function caseSummaryHtml(entry: HistEntry, session: LoadedSession): string {
  const cfg = normalizeConfig(session.cfg);
  if (entry.pr) {
    const p = entry.pr.patient || ({} as ProcedureRoom["patient"]);
    const s = isoMs(p.startedAt);
    const en = isoMs(p.endedAt);
    return `<div class="summary">
      <div class="kv-grid">${kv("Room", entry.room)}${kv("Date", fmtDateLong(entry.date))}${kv("Procedure", entry.procedure)}${kv("Staff", entry.pr.assignee)}${kv("Contact", p.contact)}${kv("Started", s !== null ? fmtTime(s) : "")}${kv("Completed", en !== null ? fmtTime(en) : "")}${kv("Duration", s !== null && en !== null ? fmtDur(en - s) : "")}</div>
      ${entry.pr.notes ? `<h4>Notes</h4><p>${E(entry.pr.notes)}</p>` : ""}
    </div>`;
  }
  const r = entry.record!;
  const v = caseView("x1", r, entry.date, cfg.checks);
  const teamRows = TD.map((def) => {
    const cells = def.r
      .map((row) => {
        const list = r.teams?.[def.k]?.[row.k] || [];
        return list.length ? `<span class="sum-role">${def.r.length > 1 ? `<em>${E(row.l)}</em>` : ""}${list.map((n) => `<span class="staff-chip sm">${avatar(n)}<span>${E(n)}</span></span>`).join("")}</span>` : "";
      })
      .join("");
    return `<div class="sum-team"><span class="k">${E(def.l)}</span><span>${cells || '<span class="muted">—</span>'}</span></div>`;
  }).join("");
  const partial = entry.kind === "case" && !session.full;
  const checks = cfg.checks
    .map((c) => `<li class="${r.preOp[c.k] ? "on" : ""}">${icon(r.preOp[c.k] ? "check" : "close")}<span>${E(c.l)}</span></li>`)
    .join("");
  return `<div class="summary">
    <div class="kv-grid">
      ${kv("Room", entry.room)}${kv("Date", fmtDateShort(entry.date))}${kv("Session lead", entry.lead)}${kv("Procedure", r.assessment.procedureType)}
      ${kv("Age", r.patient.age)}${kv("Gender", r.patient.gender)}${kv("Blood group", r.patient.bloodGroup)}${kv("Contact", r.patient.contact)}
      ${kv("Norwood", r.assessment.norwoodScale)}${kv("Donor density", r.assessment.donorDensity)}${kv("Recipient area", r.assessment.recipientArea)}${kv("Allergies", r.patient.allergies)}
    </div>
    <div class="sum-cols">
      <section><h4>Timeline</h4>${phaseTimeline(v, "history")}</section>
      <section><h4>Durations</h4>${durationSummary(v, true)}<h4>Grafts</h4>${graftPanel(v, "history")}</section>
    </div>
    ${partial ? `<p class="note">${icon("info")} Loading full record…</p>` : `
    <section><h4>Team</h4><div class="sum-teams">${teamRows}</div></section>
    <div class="sum-cols">
      <section><h4>Pre-op · ${v.preOp.done}/${v.preOp.total}</h4><ul class="sum-checks">${checks || "<li>No checklist saved</li>"}</ul>
        <div class="kv-grid three">${kv("BP", r.preOp.bp)}${kv("Pulse", r.preOp.pulse)}${kv("SpO₂", r.preOp.spo2)}</div></section>
      <section><h4>Post-op</h4><div class="kv-grid two">${kv("Prescriptions", r.postOp.prescriptions)}${kv("Follow-up", r.postOp.followUpDate)}${kv("Discharged", entry.dischargedAt || r.postOp.dischargeTime)}${kv("Medications", r.patient.medications)}</div>
        ${r.assessment.notes ? `<h4>Notes</h4><p class="sum-notes">${E(r.assessment.notes)}</p>` : ""}</section>
    </div>`}
  </div>`;
}

