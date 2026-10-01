/** Procedure timeline, phase controls and graft tracking — shared by Live Floor, Roster and History. */
import type { CaseView } from "../core/derive";
import { PHASE_ORDER, PHASE_LABEL } from "../core/timers";
import { fmtDur, spanMs } from "../core/time";
import { PHASE_TEAMS, TD } from "../state";
import type { LivePhase } from "../types";
import { avatarStack, graftBar, phaseTimer, timerText } from "../ui/components";
import { E } from "../ui/dom";
import { icon } from "../ui/icons";
import { guardAttrs } from "../ui/guard";

export type TimelineMode = "live" | "roster" | "history";

/** Page-wide +/- step for graft counters (persisted per device). */
export const graftPrefs = {
  get step(): number {
    try {
      const v = Number(localStorage.getItem("msk_graft_step"));
      return [1, 10, 50, 100].includes(v) ? v : 10;
    } catch {
      return 10;
    }
  },
  set step(v: number) {
    try {
      localStorage.setItem("msk_graft_step", String(v));
    } catch {
      /* ignore */
    }
  },
};

export function phaseTeamNames(v: CaseView, phase: LivePhase): string[] {
  const names: string[] = [];
  for (const teamKey of PHASE_TEAMS[phase]) {
    const def = TD.find((t) => t.k === teamKey);
    for (const row of def?.r || []) for (const name of v.record.teams?.[teamKey]?.[row.k] || []) if (!names.includes(name)) names.push(name);
  }
  return names;
}

function phaseAction(v: CaseView, phase: LivePhase): string {
  const st = v.states[phase];
  const label = PHASE_LABEL[phase];
  const fid = `ph-${v.key}-${phase}`;
  if (v.stage === "completed") return "";
  if (st === "active") {
    return `<button type="button" id="${fid}" class="btn dark" ${guardAttrs(`${v.key}:${phase}`)} onclick="void dsa.endPhase('${v.key}','${phase}')">${icon("stop")} End ${label}</button>`;
  }
  // Only the next phase in sequence gets a Start button; anything else is a deliberate correction via "Edit times".
  if (st === "idle" && v.next === phase) {
    return `<button type="button" id="${fid}" class="btn ${v.active ? "secondary" : "primary"}" ${v.registered ? guardAttrs(`${v.key}:${phase}`) : `disabled data-lock="1"`} onclick="void dsa.startPhase('${v.key}','${phase}')">${icon("play")} Start ${label}</button>`;
  }
  return "";
}

function phaseMeta(v: CaseView, phase: LivePhase): string {
  const g = v.grafts;
  if (phase === "extraction" && (v.states.extraction !== "idle" || g.extracted)) return `<span class="pr-meta num">${g.extracted.toLocaleString()} grafts</span>`;
  if (phase === "placing" && (v.states.placing !== "idle" || g.placed)) return `<span class="pr-meta num">${g.placed.toLocaleString()} placed</span>`;
  return "";
}

export function phaseTimeline(v: CaseView, mode: TimelineMode): string {
  const historical = mode === "history";
  return `<ol class="timeline ${mode}">
    ${PHASE_ORDER.map((phase) => {
      const st = v.states[phase];
      const team = phaseTeamNames(v, phase);
      const up = !v.active && v.next === phase && v.registered && v.stage !== "completed";
      return `<li class="phase-row is-${st}${up ? " is-next" : ""}">
        <span class="pr-rail" aria-hidden="true"><i></i></span>
        <div class="pr-head">
          <span class="pr-name">${PHASE_LABEL[phase]}</span>
          ${phaseMeta(v, phase)}
          ${mode !== "history" ? `<span class="pr-team">${team.length ? avatarStack(team, 4) : `<span class="muted small">No team</span>`}</span>` : ""}
        </div>
        <div class="pr-timer">${phaseTimer(v.spans[phase], { historical })}</div>
        ${
          historical
            ? ""
            : `<div class="pr-actions">
          ${phaseAction(v, phase)}
          ${st !== "idle" || v.registered ? `<button type="button" class="icon-btn" onclick="void dsa.editPhase('${v.key}','${phase}')" title="Edit ${PHASE_LABEL[phase]} times" aria-label="Edit ${PHASE_LABEL[phase]} times">${icon("edit")}</button>` : ""}
        </div>`
        }
      </li>`;
    }).join("")}
  </ol>`;
}

export function counter(v: CaseView, field: "grafts" | "hairline" | "middle" | "crown", value: number, label: string, big = false): string {
  const step = graftPrefs.step;
  const group = field === "grafts" ? "extraction" : "placing";
  const disabled = v.stage === "completed" ? "disabled" : "";
  return `<div class="counter ${big ? "big" : ""}" role="group" aria-label="${E(label)}">
    <span class="counter-label">${E(label)}</span>
    <div class="counter-ctl">
      <button type="button" id="cm-${v.key}-${field}" class="counter-btn" onclick="dsa.adjGraft('${v.key}','${group}','${field}',-${step})" ${disabled || value <= 0 ? "disabled" : ""} aria-label="Subtract ${step} from ${E(label)}">${icon("minus")}</button>
      <button type="button" class="counter-val num" onclick="void dsa.setGraftExact('${v.key}','${group}','${field}')" title="Tap to enter an exact number" aria-label="${E(label)}: ${value}. Enter exact number" ${disabled}>${value.toLocaleString()}</button>
      <button type="button" id="cp-${v.key}-${field}" class="counter-btn" onclick="dsa.adjGraft('${v.key}','${group}','${field}',${step})" ${disabled} aria-label="Add ${step} to ${E(label)}">${icon("plus")}</button>
    </div>
  </div>`;
}

export function stepPicker(): string {
  const step = graftPrefs.step;
  return `<div class="step-pick" role="radiogroup" aria-label="Counter step">
    <span class="muted small">Step</span>
    ${[1, 10, 50, 100].map((s) => `<button type="button" role="radio" aria-checked="${s === step}" class="seg${s === step ? " on" : ""}" onclick="dsa.setGraftStep(${s})">${s}</button>`).join("")}
  </div>`;
}

export function graftPanel(v: CaseView, mode: TimelineMode): string {
  const g = v.grafts;
  const summary = `<div class="graft-summary">
    <div><span class="gs-k">Estimated</span><span class="gs-v num">${g.estimate ? g.estimate.toLocaleString() : "—"}</span></div>
    <div><span class="gs-k">Extracted</span><span class="gs-v num">${g.extracted.toLocaleString()}</span></div>
    <div><span class="gs-k">Placed</span><span class="gs-v num">${g.placed.toLocaleString()}</span></div>
    <div><span class="gs-k">To place</span><span class="gs-v num ${g.placed > g.extracted ? "text-danger" : ""}">${g.placed > g.extracted ? `−${(g.placed - g.extracted).toLocaleString()}` : g.toPlace.toLocaleString()}</span></div>
    ${g.estimate ? `<div><span class="gs-k">To extract</span><span class="gs-v num">${g.toExtract.toLocaleString()}</span></div>` : ""}
  </div>${graftBar(g)}`;
  if (mode === "history") {
    return `${summary}<div class="zone-read"><span>Hairline <b class="num">${g.hairline.toLocaleString()}</b></span><span>Middle <b class="num">${g.middle.toLocaleString()}</b></span><span>Crown <b class="num">${g.crown.toLocaleString()}</b></span></div>`;
  }
  return `${summary}
    <div class="counters">
      ${counter(v, "grafts", g.extracted, "Extracted", true)}
      <div class="zone-counters">
        ${counter(v, "hairline", g.hairline, "Hairline")}
        ${counter(v, "middle", g.middle, "Middle")}
        ${counter(v, "crown", g.crown, "Crown")}
      </div>
    </div>`;
}

/** Durations table used on Post-Op and History summaries. */
export function durationSummary(v: CaseView, historical: boolean): string {
  const row = (label: string, span: CaseView["total"], strong = false) => {
    const st = span.startMs === null ? "idle" : span.endMs === null ? "active" : "done";
    const val =
      st === "idle" ? `<span class="muted">—</span>` : st === "active" ? (historical ? `<span class="muted">No end recorded</span>` : `<span class="live-inline"><i class="live-dot"></i>${timerText(span)}</span>`) : `<span class="num">${fmtDur(spanMs(span))}</span>`;
    return `<div class="ds-row${strong ? " strong" : ""}"><span>${label}</span>${val}</div>`;
  };
  return `<div class="dur-summary">
    ${row("Total procedure", v.total, true)}
    ${PHASE_ORDER.map((p) => row(PHASE_LABEL[p], v.spans[p])).join("")}
  </div>`;
}
