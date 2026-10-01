/** Live Floor — every active HT case as a live operation card. */
import { allCaseViews, type CaseView, caseAlerts, currentTeam, stageLabel, stageTone } from "../core/derive";
import { PHASE_LABEL } from "../core/timers";
import { fmtTime } from "../core/time";
import { roomLead } from "../state";
import { avatar, badge, emptyState, timerText } from "../ui/components";
import { E, plural } from "../ui/dom";
import { icon } from "../ui/icons";
import { graftPanel, phaseTimeline, stepPicker } from "./procedure";

export type LiveFilter = "active" | "live" | "waiting" | "all";
export let liveFilter: LiveFilter = "active";
export function setLiveFilter(f: LiveFilter): void {
  liveFilter = f;
}

function liveCard(v: CaseView): string {
  const g = v.grafts;
  const team = currentTeam(v);
  const alerts = caseAlerts(v).filter((a) => a.level !== "info");
  const lead = roomLead(v.index);
  return `<article class="op-card tone-${stageTone(v)}${v.active ? " is-live" : ""}" aria-label="OT ${v.index} ${E(v.record.patient.name)}">
    <header class="op-head">
      <div class="op-id">
        <span class="op-room">OT ${v.index}${lead ? ` · ${E(lead)}` : ""}</span>
        <h3>${E(v.record.patient.name)}</h3>
        <span class="op-meta">${E(v.record.assessment.procedureType || "—")}${g.estimate ? ` · ${g.estimate.toLocaleString()} est.` : ""}</span>
      </div>
      <div class="op-status">
        ${badge(stageLabel(v), stageTone(v), { live: Boolean(v.active) })}
        <div class="op-total">
          <span class="k">Case${v.total.startMs !== null ? ` · from ${fmtTime(v.total.startMs)}` : ""}</span>
          ${v.total.startMs !== null ? timerText(v.total, v.total.endMs === null ? "clock" : "dur", "op-total-t") : `<span class="muted">Not started</span>`}
        </div>
      </div>
    </header>
    ${alerts.length ? `<ul class="op-alerts">${alerts.map((a) => `<li class="lvl-${a.level}">${icon("warn")}<span><b>${E(a.title)}</b> ${E(a.detail)}</span></li>`).join("")}</ul>` : ""}
    <div class="op-body">
      ${phaseTimeline(v, "live")}
      <div class="op-grafts">${graftPanel(v, "live")}</div>
    </div>
    <footer class="op-foot">
      <div class="op-team">
        <span class="k">${v.active ? `Working · ${PHASE_LABEL[v.active]}` : v.waiting && v.next ? `Next · ${PHASE_LABEL[v.next]}` : "Team"}</span>
        <span class="op-team-list">${team.length ? team.map((t) => `<span class="staff-chip sm" title="${E(t.role)}">${avatar(t.name)}<span>${E(t.name)}</span></span>`).join("") : `<span class="muted small">${v.active || v.waiting ? "No team assigned" : "—"}</span>`}</span>
      </div>
      <button type="button" class="btn ghost sm" onclick="dsa.openCase('${v.key}','procedure')">Open case ${icon("arrowRight")}</button>
    </footer>
  </article>`;
}

export function renderLive(): string {
  const views = allCaseViews();
  const occupied = views.filter((v) => v.stage !== "empty");
  const counts = {
    active: occupied.filter((v) => v.stage !== "completed" && v.stage !== "preOp").length,
    live: occupied.filter((v) => v.active).length,
    waiting: occupied.filter((v) => v.stage === "preOp" || v.waiting).length,
    all: occupied.length,
  };
  const filtered = occupied.filter((v) => {
    if (liveFilter === "live") return Boolean(v.active);
    if (liveFilter === "waiting") return v.stage === "preOp" || v.waiting;
    if (liveFilter === "active") return v.stage !== "completed" && v.stage !== "preOp";
    return true;
  });
  const idle = views.filter((v) => v.stage === "empty");
  const chip = (f: LiveFilter, label: string) => `<button type="button" role="tab" aria-selected="${liveFilter === f}" class="filter-chip${liveFilter === f ? " on" : ""}" onclick="dsa.setLiveFilter('${f}')">${label}<span class="num">${counts[f]}</span></button>`;

  let body: string;
  if (filtered.length) body = `<div class="op-grid">${filtered.map(liveCard).join("")}</div>`;
  else if (!occupied.length)
    body = emptyState({ icon: "live", title: "No patients on the floor", body: "Register a patient in an OT room to start tracking the procedure.", action: `<button type="button" class="btn primary" onclick="dsa.go('roster')">Open roster</button>` });
  else if (liveFilter === "active")
    body = emptyState({ icon: "clock", title: "No active cases", body: `${plural(counts.waiting, "patient")} waiting to start. Start anaesthesia to bring a case live.`, action: `<button type="button" class="btn ghost" onclick="dsa.setLiveFilter('waiting')">Show waiting</button>` });
  else body = emptyState({ icon: "filter", title: "Nothing matches this filter", compact: true });

  return `<div class="page live">
    <div class="toolbar">
      <div class="filter-chips" role="tablist" aria-label="Filter cases">
        ${chip("active", "In procedure")}${chip("live", "Live now")}${chip("waiting", "Waiting")}${chip("all", "All patients")}
      </div>
      <div class="toolbar-end">${stepPicker()}</div>
    </div>
    ${body}
    ${idle.length ? `<p class="idle-rooms">${icon("door")} Empty: ${idle.map((v) => `<button type="button" class="link" onclick="dsa.openCase('${v.key}','patient')">OT ${v.index}</button>`).join(", ")}</p>` : ""}
  </div>`;
}

