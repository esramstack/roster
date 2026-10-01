/** Operations dashboard — the morning / live command view. */
import {
  allCaseViews,
  type Alert,
  type CaseView,
  currentTeam,
  floorAlerts,
  floorMetrics,
  stageLabel,
  stageTone,
  staffAssignments,
} from "../core/derive";
import { PHASE_LABEL } from "../core/timers";
import { fmtTime } from "../core/time";
import { procRoomKeys, prName, roomLead, state } from "../state";
import { avatarStack, badge, emptyState, journeyTrack, panel, phaseTimer, timerText } from "../ui/components";
import { E, fmtDateLong, plural } from "../ui/dom";
import { icon } from "../ui/icons";
import { prStatusMeta } from "./procedureRooms";

function metricBand(views: CaseView[], alerts: Alert[]): string {
  const m = floorMetrics(views, alerts);
  const prTotal = procRoomKeys().length;
  const pct = m.estimate ? Math.round((m.extracted / m.estimate) * 100) : 0;
  return `<div class="metric-band">
    <div class="metric wide">
      <span class="metric-k">HT cases today</span>
      <span class="metric-v num">${m.total}</span>
      <div class="metric-split">
        <span><b class="num">${m.scheduled}</b> scheduled</span>
        <span class="is-active"><b class="num">${m.inProgress}</b> in progress</span>
        <span class="is-success"><b class="num">${m.completed}</b> completed</span>
      </div>
    </div>
    <button type="button" class="metric" onclick="dsa.go('live')">
      <span class="metric-k">OT rooms</span>
      <span class="metric-v num">${m.roomsOccupied}<small>/${state.cc}</small></span>
      <span class="metric-sub">${plural(m.roomsAvailable, "room")} available</span>
    </button>
    <div class="metric">
      <span class="metric-k">Grafts extracted</span>
      <span class="metric-v num">${m.extracted.toLocaleString()}</span>
      <span class="metric-sub">${m.estimate ? `of ${m.estimate.toLocaleString()} est. · ${pct}%` : "No estimates yet"}</span>
    </div>
    <div class="metric">
      <span class="metric-k">Grafts placed</span>
      <span class="metric-v num">${m.placed.toLocaleString()}</span>
      <span class="metric-sub">${m.extracted ? `${Math.max(0, m.extracted - m.placed).toLocaleString()} awaiting placement` : "—"}</span>
    </div>
    <button type="button" class="metric" onclick="dsa.go('rooms')">
      <span class="metric-k">Procedure rooms</span>
      <span class="metric-v num">${m.prOccupied}<small>/${prTotal}</small></span>
      <span class="metric-sub">${m.queue ? `${plural(m.queue, "patient")} in queue` : "Queue empty"}</span>
    </button>
    <a class="metric ${m.attention ? "tone-attention" : ""}" href="#attention">
      <span class="metric-k">Needs attention</span>
      <span class="metric-v num">${m.attention}</span>
      <span class="metric-sub">${m.attention ? "Review below" : alerts.length ? `${plural(alerts.length, "note")} below` : "All clear"}</span>
    </a>
  </div>`;
}

function roomRow(v: CaseView, alerts: Alert[]): string {
  const lead = roomLead(v.index);
  const roomAlerts = alerts.filter((a) => a.caseKey === v.key && a.level !== "info");
  if (v.stage === "empty") {
    return `<button type="button" class="floor-row is-empty" onclick="dsa.openCase('${v.key}','patient')">
      <div class="fr-room"><span class="fr-ot">OT ${v.index}</span><span class="fr-roomname">${E(v.room)}</span></div>
      <div class="fr-empty">${icon("plus")} Register patient${lead ? ` · Lead ${E(lead)}` : ""}</div>
    </button>`;
  }
  const g = v.grafts;
  const team = currentTeam(v).map((t) => t.name);
  const phaseSpan = v.active ? v.spans[v.active] : null;
  return `<button type="button" class="floor-row tone-${stageTone(v)}" onclick="dsa.openCase('${v.key}','${v.active || v.waiting ? "procedure" : v.stage === "postOp" ? "postop" : "patient"}')" aria-label="${E(v.room)}: ${E(v.record.patient.name)}, ${E(stageLabel(v))}">
    <div class="fr-room"><span class="fr-ot">OT ${v.index}</span><span class="fr-roomname">${lead ? `Lead ${E(lead)}` : E(v.room)}</span></div>
    <div class="fr-patient">
      <strong>${E(v.record.patient.name)}</strong>
      <span class="muted">${E(v.record.assessment.procedureType || "—")}${g.estimate ? ` · ${g.estimate.toLocaleString()} est.` : ""}${v.record.startTime ? ` · ${E(v.record.startTime)}` : ""}</span>
    </div>
    <div class="fr-stage">
      ${badge(stageLabel(v), stageTone(v), { live: Boolean(v.active) })}
      ${journeyTrack(v, { compact: true })}
    </div>
    <div class="fr-timer">
      ${phaseSpan ? `<span class="fr-t-main">${timerText(phaseSpan)}</span><span class="fr-t-sub">${PHASE_LABEL[v.active!]}</span>` : `<span class="fr-t-sub">${v.waiting ? "Between phases" : "—"}</span>`}
    </div>
    <div class="fr-case">
      ${v.total.startMs !== null ? `<span class="fr-t-main">${timerText(v.total, v.total.endMs === null ? "clock" : "dur")}</span><span class="fr-t-sub">since ${fmtTime(v.total.startMs)}</span>` : `<span class="fr-t-sub">—</span>`}
    </div>
    <div class="fr-grafts">
      <span class="num"><b>${g.extracted.toLocaleString()}</b>${g.estimate ? `<small>/${g.estimate.toLocaleString()}</small>` : ""}</span>
      <span class="fr-t-sub">placed ${g.placed.toLocaleString()}</span>
    </div>
    <div class="fr-team">${team.length ? avatarStack(team, 3) : `<span class="fr-t-sub">${v.active || v.waiting ? "No team" : ""}</span>`}</div>
    <div class="fr-flags">${roomAlerts.length ? `<span class="flag-count ${roomAlerts.some((a) => a.level === "critical") ? "is-critical" : ""}" title="${E(roomAlerts.map((a) => a.title).join(" · "))}">${icon("warn")}${roomAlerts.length}</span>` : v.preOp.total && v.preOp.done < v.preOp.total ? `<span class="fr-t-sub" title="Pre-op checklist">${v.preOp.done}/${v.preOp.total}</span>` : ""}${icon("chevronRight", "ico chev")}</div>
  </button>`;
}

function alertList(alerts: Alert[]): string {
  if (!alerts.length) return emptyState({ icon: "check", title: "Nothing needs attention", body: "Alerts appear here from checklist, team, timer and graft data.", compact: true });
  return `<ul class="alert-list">${alerts
    .map(
      (a) => `<li><button type="button" class="alert-item lvl-${a.level}" onclick="dsa.openCase('${a.caseKey}','${a.tab}')">
        <span class="alert-ico">${icon(a.level === "info" ? "info" : "warn")}</span>
        <span class="alert-copy"><strong>${E(a.title)}</strong><span>OT ${a.roomIndex} · ${E(state.C[a.caseKey]?.patient.name || "")} — ${E(a.detail)}</span></span>
      </button></li>`,
    )
    .join("")}</ul>`;
}

function procRoomsMini(): string {
  const rows = procRoomKeys().map((key, i) => {
    const room = state.PR[key];
    if (!room) return "";
    const meta = prStatusMeta(room);
    const start = room.patient.startedAt ? Date.parse(room.patient.startedAt) : NaN;
    const end = room.patient.endedAt ? Date.parse(room.patient.endedAt) : NaN;
    const span = { startMs: Number.isFinite(start) ? start : null, endMs: Number.isFinite(end) ? end : null, approx: false };
    return `<button type="button" class="mini-row" onclick="dsa.openProcRoom('${key}')">
      <span class="mini-main"><strong>${E(prName(i + 1))}</strong><span class="muted">${E(room.patient.name || "No patient")}${room.procedure ? ` · ${E(room.procedure)}` : ""}</span></span>
      <span class="mini-side">${room.status === "occupied" && span.startMs !== null ? timerText(span) : ""}${badge(meta.label, meta.tone, { dot: true })}${room.queue?.length ? `<span class="muted small">${room.queue.length} waiting</span>` : ""}</span>
    </button>`;
  });
  return rows.join("") || emptyState({ title: "No procedure rooms", compact: true });
}

function staffingNow(): string {
  const map = staffAssignments();
  const live = [...map.entries()]
    .map(([name, list]) => ({ name, list: list.filter((a) => a.live) }))
    .filter((x) => x.list.length)
    .sort((a, b) => a.list[0].roomIndex - b.list[0].roomIndex || a.name.localeCompare(b.name));
  if (!live.length) return emptyState({ title: "No phases running", body: "Staff working in live phases will appear here.", compact: true });
  const clash = live.filter((x) => new Set(x.list.map((a) => a.roomIndex)).size > 1);
  return `${clash.length ? `<p class="note warn">${icon("warn")} ${E(clash.map((c) => c.name).join(", "))} ${clash.length > 1 ? "are" : "is"} assigned to live phases in more than one room.</p>` : ""}
  <ul class="staff-now">${live
    .map((x) => `<li><span class="sn-name">${E(x.name)}</span><span class="sn-where">${x.list.map((a) => `OT ${a.roomIndex} · ${E(a.row === "Team" ? a.team : `${a.team} ${a.row}`)}`).join(", ")}</span></li>`)
    .join("")}</ul>`;
}

export function renderOverview(): string {
  const views = allCaseViews();
  const alerts = floorAlerts(views);
  const live = views.filter((v) => v.active);
  const focus = live.length
    ? `<div class="live-strip">${live
        .map((v) => `<button type="button" class="live-chip" onclick="dsa.openCase('${v.key}','procedure')"><span class="lc-room">OT ${v.index}</span><span class="lc-phase">${PHASE_LABEL[v.active!]}</span>${phaseTimer(v.spans[v.active!])}</button>`)
        .join("")}</div>`
    : "";
  return `<div class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">${E(fmtDateLong(state.sessionDate))}</p>
        <h2 class="page-title">Operating floor</h2>
      </div>
      <div class="page-head-actions">
        <button type="button" class="btn ghost" onclick="dsa.go('roster')">${icon("roster")} Roster</button>
        <button type="button" class="btn primary" onclick="dsa.go('live')">${icon("live")} Live Floor</button>
      </div>
    </div>
    ${metricBand(views, alerts)}
    ${focus}
    <div class="overview-grid">
      ${panel({
        title: "OT rooms",
        sub: `${state.cc} rooms · click a room to open its record`,
        actions: `<button type="button" class="btn ghost sm" onclick="void dsa.addRoom()">${icon("plus")} Add room</button>`,
        flush: true,
        className: "floor-panel",
        body: `<div class="floor-head" aria-hidden="true"><span>Room</span><span>Patient</span><span>Stage</span><span>Phase</span><span>Case</span><span>Grafts</span><span>Team</span><span></span></div>
          <div class="floor-list">${views.map((v) => roomRow(v, alerts)).join("")}</div>`,
      })}
      <div class="overview-side">
        ${panel({ id: "attention", title: "Attention required", sub: alerts.length ? plural(alerts.length, "item") : "", body: alertList(alerts), className: "attention-panel" })}
        ${panel({ title: "On the floor now", body: staffingNow() })}
        ${panel({ title: "Procedure rooms", actions: `<button type="button" class="btn ghost sm" onclick="dsa.go('rooms')">Open</button>`, body: `<div class="mini-list">${procRoomsMini()}</div>`, flush: true })}
      </div>
    </div>
  </div>`;
}
