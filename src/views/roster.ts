/** Today's Roster: fast room switching + step-based case workflow. */
import { caseView, type CaseView, stageLabel, stageTone, staffAssignments } from "../core/derive";
import { PHASE_LABEL } from "../core/timers";
import { caseKeys, DEF_PROCS, roomLead, state, TD } from "../state";
import type { RosterTab } from "../types";
import { avatar, badge, emptyState, field, journeyTrack, panel, segmented, timerText } from "../ui/components";
import { E, maybeId } from "../ui/dom";
import { icon } from "../ui/icons";
import { durationSummary, graftPanel, phaseTimeline, stepPicker } from "./procedure";

export const STEPS: Array<{ tab: RosterTab; label: string }> = [
  { tab: "patient", label: "Patient" },
  { tab: "assessment", label: "Assessment" },
  { tab: "preop", label: "Pre-Op" },
  { tab: "teams", label: "Teams" },
  { tab: "procedure", label: "Procedure" },
  { tab: "postop", label: "Post-Op" },
];

export const NORWOOD = ["I", "II", "IIa", "III", "IIIa", "III Vertex", "IV", "IVa", "V", "Va", "VI", "VII"];
export const LUDWIG = ["Ludwig I", "Ludwig II", "Ludwig III"];
export const DENSITY = ["Poor", "Average", "Good", "Excellent"];
export const RECIPIENT = ["Hairline", "Frontal", "Mid-scalp", "Crown", "Temples", "Beard", "Moustache", "Eyebrows"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function validAge(v: string): string {
  return v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 120) ? "" : "Enter an age between 0 and 120.";
}
export function validContact(v: string): string {
  return v === "" || /^[+()\d\s-]{7,20}$/.test(v) ? "" : "Use digits, spaces, +, - or parentheses.";
}
export function validGrafts(v: string): string {
  return v === "" || /^\d{1,6}$/.test(v) ? "" : "Enter a whole number.";
}

function roomStrip(): string {
  return `<nav class="room-strip" aria-label="OT rooms">
    ${caseKeys()
      .map((key) => {
        const v = caseView(key);
        const on = state.selectedCase === key;
        const span = v.active ? v.spans[v.active] : null;
        return `<button type="button" class="room-chip tone-${stageTone(v)}${on ? " on" : ""}" onclick="dsa.pickCase('${key}')" ${on ? 'aria-current="true"' : ""}>
          <span class="rc-top"><span class="rc-ot">OT ${v.index}</span><i class="rc-dot${v.active ? " live" : ""}" aria-hidden="true"></i></span>
          <span class="rc-name">${E(v.record.patient.name || "Empty")}</span>
          <span class="rc-sub">${span ? timerText(span) : v.stage === "empty" ? "Free" : E(stageLabel(v))}</span>
        </button>`;
      })
      .join("")}
    <button type="button" class="room-chip add" onclick="void dsa.addRoom()" title="Add OT room">${icon("plus")}<span class="rc-name">Add room</span></button>
  </nav>`;
}

function caseHeader(v: CaseView): string {
  const p = v.record.patient;
  const a = v.record.assessment;
  const lead = roomLead(v.index);
  const meta = [p.age ? `${p.age} yrs` : "", p.gender, p.bloodGroup, a.procedureType, a.norwoodScale ? (NORWOOD.includes(a.norwoodScale) ? `Norwood ${a.norwoodScale}` : a.norwoodScale) : ""].filter(Boolean);
  const activeSpan = v.active ? v.spans[v.active] : null;
  return `<header class="case-head">
    <div class="ch-id">
      <span class="ch-room">OT ${v.index} · ${E(v.room)}${lead ? ` · Lead ${E(lead)}` : ""}</span>
      <h2>${E(p.name || "No patient registered")}</h2>
      <p class="ch-meta">${meta.length ? meta.map(E).join('<span class="sep">·</span>') : "Register the patient to begin."}</p>
    </div>
    <div class="ch-status">
      ${badge(stageLabel(v), stageTone(v), { live: Boolean(v.active) })}
      <div class="ch-timers">
        ${activeSpan ? `<div class="ch-timer"><span class="k">${PHASE_LABEL[v.active!]}</span>${timerText(activeSpan, "clock", "big")}</div>` : ""}
        <div class="ch-timer"><span class="k">Case</span>${v.total.startMs !== null ? timerText(v.total, v.total.endMs === null ? "clock" : "dur", activeSpan ? "" : "big") : `<span class="muted">Not started</span>`}</div>
        <div class="ch-timer"><span class="k">Grafts</span><span class="num">${v.grafts.extracted.toLocaleString()}${v.grafts.estimate ? `<small class="muted"> / ${v.grafts.estimate.toLocaleString()}</small>` : ""}</span></div>
      </div>
    </div>
    <div class="ch-journey">${journeyTrack(v)}</div>
  </header>`;
}

function stepState(v: CaseView, tab: RosterTab): { done: boolean; note: string; tone?: string } {
  const r = v.record;
  switch (tab) {
    case "patient":
      return { done: v.registered, note: v.registered ? "" : "Required" };
    case "assessment":
      return { done: Boolean(r.assessment.procedureType && r.assessment.graftEstimate), note: "" };
    case "preop":
      return { done: v.preOp.total > 0 && v.preOp.done >= v.preOp.total, note: `${v.preOp.done}/${v.preOp.total}`, tone: v.preOp.done < v.preOp.total ? "attention" : "" };
    case "teams": {
      const empty = TD.filter((t) => Object.values(r.teams?.[t.k] || {}).every((l) => !l?.length)).length;
      return { done: empty === 0, note: empty ? `${empty} open` : "" };
    }
    case "procedure":
      return { done: v.states.dressing === "done", note: v.active ? "Live" : "", tone: v.active ? "live" : "" };
    case "postop":
      return { done: v.stage === "completed", note: "" };
  }
}

function stepNav(v: CaseView): string {
  return `<div class="steps" role="tablist" aria-label="Case workflow">
    ${STEPS.map((s, i) => {
      const st = stepState(v, s.tab);
      const on = state.selectedRosterTab === s.tab;
      return `<button type="button" role="tab" aria-selected="${on}" class="step${on ? " on" : ""}${st.done ? " done" : ""}${st.tone ? ` tone-${st.tone}` : ""}" onclick="dsa.pickRosterTab('${s.tab}')">
        <span class="step-n" aria-hidden="true">${st.done ? icon("check") : i + 1}</span>
        <span class="step-l">${s.label}</span>
        ${st.note ? `<span class="step-note">${st.tone === "live" ? '<i class="live-dot"></i>' : ""}${E(st.note)}</span>` : ""}
      </button>`;
    }).join("")}
  </div>`;
}

function input(key: string, path: string, value: string, opts: { type?: string; placeholder?: string; id?: string; inputmode?: string; list?: string; max?: string; min?: string; validate?: string } = {}): string {
  return `<input id="${opts.id ?? `f-${key}-${path.replace(/\./g, "-")}`}" type="${opts.type ?? "text"}" value="${E(value)}" ${opts.placeholder ? `placeholder="${E(opts.placeholder)}"` : ""} ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ""} ${opts.list ? `list="${opts.list}"` : ""} ${opts.min ? `min="${opts.min}"` : ""} ${opts.max ? `max="${opts.max}"` : ""} ${opts.validate ? `data-validate="${opts.validate}"` : ""} onchange="dsa.setField('${key}','${path}',this.value,this)">`;
}

function patientStep(v: CaseView): string {
  const k = v.key;
  const p = v.record.patient;
  const started = v.total.startMs !== null;
  return `<div class="form-stack">
    ${panel({
      title: "Patient",
      sub: "Identity and contact",
      body: `<div class="grid g-4">
        ${field({ label: "Full name", required: true, span: 2, id: `f-${k}-patient-name`, control: input(k, "patient.name", p.name, { placeholder: "Patient full name" }) })}
        ${field({ label: "Contact", span: 2, id: `f-${k}-patient-contact`, error: validContact(p.contact), control: input(k, "patient.contact", p.contact, { type: "tel", placeholder: "+92 …", inputmode: "tel", validate: "contact" }) })}
        ${field({ label: "Age", id: `f-${k}-patient-age`, error: validAge(p.age), control: input(k, "patient.age", p.age, { inputmode: "numeric", placeholder: "Years", validate: "age" }) })}
        ${field({
          label: "Gender",
          span: 3,
          control: segmented({ name: "gender", label: "Gender", value: p.gender, onPick: `dsa.setChoice('${k}','patient.gender',this.dataset.value)`, options: [{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "Other", label: "Other" }] }),
        })}
      </div>`,
    })}
    ${panel({
      title: "Clinical",
      sub: "Shown to the OT team",
      body: `<div class="grid g-4">
        ${field({
          label: "Blood group",
          control: `<select id="f-${k}-bg" onchange="dsa.setField('${k}','patient.bloodGroup',this.value,this)"><option value="">Select</option>${BLOOD.map((b) => `<option ${b === p.bloodGroup ? "selected" : ""}>${b}</option>`).join("")}${p.bloodGroup && !BLOOD.includes(p.bloodGroup) ? `<option selected>${E(p.bloodGroup)}</option>` : ""}</select>`,
        })}
        ${field({ label: "Allergies", span: 3, id: `f-${k}-patient-allergies`, hint: "Leave blank if none known", control: input(k, "patient.allergies", p.allergies, { placeholder: "e.g. Penicillin, latex" }) })}
        ${field({ label: "Current medications", span: 4, id: `f-${k}-patient-medications`, control: input(k, "patient.medications", p.medications || "", { placeholder: "Medications the patient is taking" }) })}
      </div>`,
    })}
    ${panel({
      title: "Schedule",
      sub: "Planned times, used for delay alerts",
      body: `<div class="grid g-4">
        ${field({ label: "Scheduled start", id: `f-${k}-startTime`, control: input(k, "startTime", v.record.startTime, { type: "time" }) })}
        ${field({ label: "Scheduled end", id: `f-${k}-endTime`, control: input(k, "endTime", v.record.endTime, { type: "time" }) })}
      </div>`,
    })}
    ${
      v.registered && !started
        ? `<div class="danger-zone"><div><strong>Clear this room</strong><p>Removes the patient and all entries for OT ${v.index}. Use this for a registration made in the wrong room.</p></div><button type="button" class="btn danger-ghost" onclick="void dsa.clearRoom('${k}')">${icon("trash")} Clear room</button></div>`
        : ""
    }
  </div>`;
}

function chipGroup(opts: { values: string[]; selected: string[]; onPick: string; multi?: boolean; label: string }): string {
  return `<div class="chip-choices" role="${opts.multi ? "group" : "radiogroup"}" aria-label="${E(opts.label)}">
    ${opts.values
      .map((val) => {
        const on = opts.selected.includes(val);
        return `<button type="button" class="choice${on ? " on" : ""}" ${opts.multi ? `aria-pressed="${on}"` : `role="radio" aria-checked="${on}"`} data-value="${E(val)}" onclick="${opts.onPick}">${on && opts.multi ? icon("check") : ""}${E(val)}</button>`;
      })
      .join("")}
  </div>`;
}

function assessmentStep(v: CaseView): string {
  const k = v.key;
  const a = v.record.assessment;
  const procs = state.cfg.procedures.length ? state.cfg.procedures : DEF_PROCS;
  const areas = a.recipientArea.split(",").map((s) => s.trim()).filter(Boolean);
  const customAreas = areas.filter((x) => !RECIPIENT.includes(x));
  const norwoodCustom = a.norwoodScale && !NORWOOD.includes(a.norwoodScale) && !LUDWIG.includes(a.norwoodScale) ? a.norwoodScale : "";
  const densityCustom = a.donorDensity && !DENSITY.includes(a.donorDensity) ? a.donorDensity : "";
  return `<div class="form-stack">
    ${panel({
      title: "Procedure",
      body: `<div class="grid g-4">
        ${field({
          label: "Procedure type",
          span: 4,
          control: chipGroup({ label: "Procedure type", values: procs.includes(a.procedureType) || !a.procedureType ? procs : [...procs, a.procedureType], selected: [a.procedureType], onPick: `dsa.setChoice('${k}','assessment.procedureType',this.dataset.value)` }),
          hint: "Procedure types are managed in Settings",
        })}
        ${field({
          label: "Estimated grafts",
          id: `f-${k}-assessment-graftEstimate`,
          error: validGrafts(a.graftEstimate),
          control: `<div class="input-affix">${input(k, "assessment.graftEstimate", a.graftEstimate, { inputmode: "numeric", placeholder: "0", validate: "grafts" })}<span>grafts</span></div>`,
        })}
      </div>`,
    })}
    ${panel({
      title: "Hair loss assessment",
      body: `<div class="grid g-4">
        ${field({
          label: "Norwood scale",
          span: 4,
          control: `${chipGroup({ label: "Norwood scale", values: NORWOOD, selected: [a.norwoodScale], onPick: `dsa.toggleChoice('${k}','assessment.norwoodScale',this.dataset.value)` })}
            <div class="chip-sub">${chipGroup({ label: "Ludwig scale", values: LUDWIG, selected: [a.norwoodScale], onPick: `dsa.toggleChoice('${k}','assessment.norwoodScale',this.dataset.value)` })}
            <input class="inline-other" id="f-${k}-norwood-other" value="${E(norwoodCustom)}" placeholder="Other classification" aria-label="Other classification" onchange="dsa.setField('${k}','assessment.norwoodScale',this.value,this)"></div>`,
        })}
        ${field({
          label: "Donor density",
          span: 2,
          control: `${chipGroup({ label: "Donor density", values: DENSITY, selected: [a.donorDensity], onPick: `dsa.toggleChoice('${k}','assessment.donorDensity',this.dataset.value)` })}
            <input class="inline-other" id="f-${k}-density-other" value="${E(densityCustom)}" placeholder="Or measured value, e.g. 80 FU/cm²" aria-label="Donor density value" onchange="dsa.setField('${k}','assessment.donorDensity',this.value,this)">`,
        })}
        ${field({
          label: "Recipient area",
          span: 2,
          control: `${chipGroup({ label: "Recipient area", values: [...RECIPIENT, ...customAreas], selected: areas, multi: true, onPick: `dsa.toggleArea('${k}',this.dataset.value)` })}`,
        })}
      </div>`,
    })}
    ${panel({
      title: "Clinical notes",
      body: field({ label: "Notes", control: `<textarea id="f-${k}-notes" rows="4" placeholder="Planning notes, observations…" onchange="dsa.setField('${k}','assessment.notes',this.value,this)">${E(a.notes)}</textarea>` }),
    })}
  </div>`;
}

function preopStep(v: CaseView): string {
  const k = v.key;
  const r = v.record;
  const checks = state.cfg.checks;
  const pct = v.preOp.total ? Math.round((v.preOp.done / v.preOp.total) * 100) : 0;
  const ready = v.preOp.total > 0 && v.preOp.done >= v.preOp.total;
  return `<div class="form-stack">
    <section class="readiness ${ready ? "is-ready" : ""}">
      <div class="rd-score"><span class="rd-num num">${v.preOp.done}<small> / ${v.preOp.total}</small></span><span class="rd-label">${ready ? "Ready for procedure" : "Ready"}</span></div>
      <div class="rd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${v.preOp.total}" aria-valuenow="${v.preOp.done}" aria-label="Pre-op readiness"><i style="width:${pct}%"></i></div>
      <p class="rd-note">${ready ? "All checklist items confirmed." : `${v.preOp.total - v.preOp.done} item${v.preOp.total - v.preOp.done === 1 ? "" : "s"} pending.`}</p>
    </section>
    ${panel({
      title: "Checklist",
      sub: "Tap an item to confirm it",
      flush: true,
      body: checks.length
        ? `<ul class="checklist">${checks
            .map((c) => {
              const on = Boolean(r.preOp[c.k]);
              return `<li><button type="button" id="chk-${k}-${E(c.k)}" class="check-item${on ? " on" : ""}" aria-pressed="${on}" onclick="dsa.togglePreOp('${k}','${E(c.k)}')">
                <span class="check-box" aria-hidden="true">${on ? icon("check") : ""}</span>
                <span class="check-copy"><strong>${E(c.l)}</strong>${c.s ? `<span>${E(c.s)}</span>` : ""}</span>
                <span class="check-state">${on ? "Confirmed" : "Pending"}</span>
              </button></li>`;
            })
            .join("")}</ul>`
        : emptyState({ title: "No checklist items", body: "Add pre-op checklist items in Settings.", compact: true }),
    })}
    ${panel({
      title: "Vitals",
      body: `<div class="vitals">
        <label class="vital"><span class="vital-k">${icon("heart")} Blood pressure</span><span class="input-affix">${input(k, "preOp.bp", String(r.preOp.bp || ""), { placeholder: "120/80" })}<span>mmHg</span></span></label>
        <label class="vital"><span class="vital-k">${icon("pulse")} Pulse</span><span class="input-affix">${input(k, "preOp.pulse", String(r.preOp.pulse || ""), { inputmode: "numeric", placeholder: "72" })}<span>bpm</span></span></label>
        <label class="vital"><span class="vital-k">${icon("drop")} SpO₂</span><span class="input-affix">${input(k, "preOp.spo2", String(r.preOp.spo2 || ""), { inputmode: "numeric", placeholder: "98" })}<span>%</span></span></label>
      </div>`,
    })}
  </div>`;
}

export function teamsStep(v: CaseView, view: "stage" | "staff"): string {
  const k = v.key;
  const assignments = staffAssignments();
  const toggle = `<div class="segmented sm" role="radiogroup" aria-label="Team view">
    <button type="button" role="radio" aria-checked="${view === "stage"}" class="seg${view === "stage" ? " on" : ""}" onclick="dsa.setTeamView('stage')">By stage</button>
    <button type="button" role="radio" aria-checked="${view === "staff"}" class="seg${view === "staff" ? " on" : ""}" onclick="dsa.setTeamView('staff')">By staff</button>
  </div>`;
  const tools = `${toggle}
    <button type="button" class="btn ghost sm" onclick="void dsa.copyTeams('${k}')">${icon("copy")} Copy from room</button>
    <button type="button" class="btn ghost sm" onclick="void dsa.resetTeams('${k}')">${icon("refresh")} Defaults</button>`;

  if (view === "staff") {
    const rows: string[] = [];
    const names = new Set<string>();
    for (const def of TD) for (const row of def.r) for (const n of v.record.teams?.[def.k]?.[row.k] || []) names.add(n);
    for (const name of [...names].sort()) {
      const here: string[] = [];
      for (const def of TD) for (const row of def.r) if ((v.record.teams?.[def.k]?.[row.k] || []).includes(name)) here.push(def.r.length > 1 ? `${def.l} · ${row.l}` : def.l);
      const elsewhere = (assignments.get(name) || []).filter((a) => a.roomKey !== k);
      const rooms = [...new Set(elsewhere.map((a) => `OT ${a.roomIndex}${a.live ? " (live)" : ""}`))];
      rows.push(`<tr><td>${avatar(name)} <strong>${E(name)}</strong></td><td>${here.map((h) => `<span class="tag">${E(h)}</span>`).join(" ")}</td><td class="muted small">${rooms.length ? E(rooms.join(", ")) : "—"}</td></tr>`);
    }
    return panel({
      title: "Team assignment",
      sub: `${names.size} staff on this case`,
      actions: tools,
      flush: true,
      body: rows.length ? `<table class="table"><thead><tr><th>Staff</th><th>Responsible for</th><th>Also assigned</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : emptyState({ icon: "users", title: "No staff assigned", body: "Switch to “By stage” to assign staff.", compact: true }),
    });
  }

  const cards = TD.map((def) => {
    const rows = def.r
      .map((row) => {
        const list = v.record.teams?.[def.k]?.[row.k] || [];
        return `<div class="role-row">
          <span class="role-label">${E(row.l)}</span>
          <div class="role-chips">
            ${list
              .map((name, i) => {
                // Flag only real clashes: this person is working a live phase in another room right now.
                const liveElsewhere = [...new Set((assignments.get(name) || []).filter((a) => a.roomKey !== k && a.live).map((a) => `OT ${a.roomIndex}`))];
                return `<span class="staff-chip">${avatar(name)}<span>${E(name)}</span>${liveElsewhere.length ? `<span class="sc-also" title="Working a live phase in ${E(liveElsewhere.join(", "))}">${E(liveElsewhere.join(", "))}</span>` : ""}<button type="button" onclick="void dsa.removeMember('${k}','${def.k}','${row.k}',${i})" aria-label="Remove ${E(name)} from ${E(def.l)} ${E(row.l)}">${icon("close")}</button></span>`;
              })
              .join("")}
            <button type="button" class="add-chip" onclick="void dsa.pickStaff('${k}','${def.k}','${row.k}')" aria-label="Assign staff to ${E(def.l)} ${E(row.l)}">${icon("plus")}<span>${list.length ? "" : "Assign"}</span></button>
          </div>
        </div>`;
      })
      .join("");
    const count = def.r.reduce((s, row) => s + (v.record.teams?.[def.k]?.[row.k]?.length || 0), 0);
    return `<div class="team-card${count ? "" : " is-empty"}"><div class="tc-head"><strong>${E(def.l)}</strong><span class="muted small">${count || "Unassigned"}</span></div>${rows}</div>`;
  }).join("");
  return panel({ title: "Team assignment", sub: "Who works where, by stage", actions: tools, body: `<div class="team-grid">${cards}</div>` });
}

function procedureStep(v: CaseView): string {
  if (!v.registered) return emptyState({ icon: "user", title: "No patient registered", body: "Register the patient before recording procedure times.", action: `<button type="button" class="btn primary" onclick="dsa.pickRosterTab('patient')">Register patient</button>` });
  return `<div class="proc-layout">
    ${panel({ title: "Procedure timeline", sub: "Start and end each phase as it happens", body: phaseTimeline(v, "roster") })}
    ${panel({ title: "Graft tracking", actions: stepPicker(), body: graftPanel(v, "roster") })}
  </div>`;
}

function postopStep(v: CaseView): string {
  const k = v.key;
  const po = v.record.postOp;
  const running = v.active;
  return `<div class="proc-layout">
    <div class="form-stack">
      ${panel({
        title: "Discharge plan",
        body: `<div class="grid g-2">
          ${field({ label: "Prescriptions / care kit", span: 2, control: `<textarea id="f-${k}-rx" rows="3" placeholder="Medications and care instructions given" onchange="dsa.setField('${k}','postOp.prescriptions',this.value,this)">${E(po.prescriptions)}</textarea>` })}
          ${field({ label: "Follow-up date", id: `f-${k}-postOp-followUpDate`, control: input(k, "postOp.followUpDate", po.followUpDate, { type: "date" }) })}
          ${field({ label: "Discharge time", id: `f-${k}-postOp-dischargeTime`, hint: "Set automatically on discharge if empty", control: input(k, "postOp.dischargeTime", po.dischargeTime, { type: "time" }) })}
          ${field({ label: "Clinical notes", span: 2, control: `<textarea id="f-${k}-notes2" rows="3" onchange="dsa.setField('${k}','assessment.notes',this.value,this)">${E(v.record.assessment.notes)}</textarea>` })}
        </div>`,
      })}
    </div>
    <div class="form-stack">
      ${panel({ title: "Case summary", body: `${durationSummary(v, false)}${graftPanel(v, "history")}` })}
      <div class="complete-bar">
        ${running ? `<p class="note warn">${icon("warn")} ${PHASE_LABEL[running]} is still running. End it before discharge.</p>` : ""}
        <button type="button" class="btn success block" onclick="void dsa.discharge('${k}')" ${v.registered && !running ? "" : "disabled"}>${icon("check")} Complete case & discharge</button>
      </div>
    </div>
  </div>`;
}

export let teamView: "stage" | "staff" = "stage";
export function setTeamViewMode(mode: "stage" | "staff"): void {
  teamView = mode;
}

function stepBody(v: CaseView): string {
  switch (state.selectedRosterTab) {
    case "patient":
      return patientStep(v);
    case "assessment":
      return assessmentStep(v);
    case "preop":
      return preopStep(v);
    case "teams":
      return teamsStep(v, teamView);
    case "procedure":
      return procedureStep(v);
    case "postop":
      return postopStep(v);
  }
}

function stepFooter(): string {
  const i = STEPS.findIndex((s) => s.tab === state.selectedRosterTab);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return `<div class="step-foot">
    ${prev ? `<button type="button" class="btn ghost" onclick="dsa.pickRosterTab('${prev.tab}')">${icon("chevronLeft")} ${prev.label}</button>` : "<span></span>"}
    ${next ? `<button type="button" class="btn secondary" onclick="dsa.pickRosterTab('${next.tab}')">${next.label} ${icon("chevronRight")}</button>` : ""}
  </div>`;
}

export function renderRoster(): string {
  if (!state.C[state.selectedCase]) state.selectedCase = "case1";
  const v = caseView(state.selectedCase);
  return `<div class="page roster">
    <div id="roomStripHost">${roomStrip()}</div>
    <div id="rosterHead">${caseHeader(v)}</div>
    <div id="rosterSteps">${stepNav(v)}</div>
    <div id="rosterBody" class="step-body" role="tabpanel">${stepBody(v)}${stepFooter()}</div>
  </div>`;
}

/** Refresh header, room strip and step states without replacing the form being edited. */
export function renderRosterChrome(): void {
  const v = caseView(state.selectedCase);
  const strip = maybeId("roomStripHost");
  const head = maybeId("rosterHead");
  const steps = maybeId("rosterSteps");
  if (strip) {
    const scroll = strip.querySelector(".room-strip")?.scrollLeft ?? 0;
    strip.innerHTML = roomStrip();
    const nav = strip.querySelector(".room-strip");
    if (nav) nav.scrollLeft = scroll;
  }
  if (head) head.innerHTML = caseHeader(v);
  if (steps) steps.innerHTML = stepNav(v);
}

