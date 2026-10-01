/**
 * Every user action (exposed as `window.dsa` for inline handlers).
 * Actions mutate `state`, schedule a save and re-render.
 */
import { once } from "./ui/guard";
import type { User } from "@supabase/supabase-js";
import { apiRequest, signIn, signOut } from "./api";
import { caseView, graftStats, stageLabel } from "./core/derive";
import { flushSave, hasLocalChanges, loadSession, saveNow, scheduleSave, startSync, stopSync } from "./core/sync";
import { fmtClock, fmtDur, fmtTime, fromLocalInput, hhmm, isoMs, spanMs, toLocalInput } from "./core/time";
import { applyClear, applyEdit, applyEnd, applyStart, checkEdit, checkEnd, checkStart, PHASE_LABEL } from "./core/timers";
import { render, renderChrome, renderSoon } from "./render";
import {
  caseIndex,
  caseKeys,
  DEF_CHECKS,
  DEF_PROC_ROOMS,
  DEF_PROCS,
  DEF_STAFF,
  defaultCase,
  defaultProcedureRoom,
  defaultTeams,
  ensureCases,
  procRoomKeys,
  prName,
  roomName,
  state,
  TD,
  today,
} from "./state";
import type { AppTab, CaseRecord, HistoryResponse, LivePhase, LoadedSession, ProcedureRoom, RosterTab, SettingsTab } from "./types";
import { avatar } from "./ui/components";
import { byId, E, errorMessage, fmtDateLong, maybeId } from "./ui/dom";
import { icon } from "./ui/icons";
import { closeDialog, confirmDialog, dialog, dialogValue, toast } from "./ui/overlay";
import { caseSummaryHtml, historyFilter, sessionEntries } from "./views/history";
import { setLiveFilter, type LiveFilter } from "./views/live";
import { durationSummary, graftPrefs } from "./views/procedure";
import { setTeamViewMode, validAge, validContact, validGrafts } from "./views/roster";

type Rec = Record<string, unknown>;
function setPath(target: Rec, path: string, value: unknown): void {
  const parts = path.split(".");
  let obj = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
    obj = obj[parts[i]] as Rec;
  }
  obj[parts[parts.length - 1]] = value;
}

function getPath(target: Rec, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Rec)[k] : undefined), target);
}

function rec(key: string): CaseRecord | null {
  const r = state.C[key];
  if (!r) toast(`Room ${key} not found.`, "error");
  return r ?? null;
}

const VALIDATORS: Record<string, (v: string) => string> = {
  age: validAge,
  contact: validContact,
  grafts: validGrafts,
};

/** Fields whose change alters other controls on the same step. */
const RERENDER_PATHS = new Set(["assessment.norwoodScale", "assessment.donorDensity", "startTime", "endTime"]);

function showFieldError(el: HTMLElement | undefined, message: string): void {
  const wrap = el?.closest(".field");
  if (!wrap) return;
  wrap.classList.toggle("has-error", Boolean(message));
  let box = wrap.querySelector<HTMLElement>(".field-error");
  const hint = wrap.querySelector<HTMLElement>(".field-hint");
  if (message) {
    if (!box) {
      box = document.createElement("span");
      box.className = "field-error";
      box.setAttribute("role", "alert");
      wrap.appendChild(box);
    }
    box.textContent = message;
    if (hint) hint.hidden = true;
  } else {
    box?.remove();
    if (hint) hint.hidden = false;
  }
}

function staffHint(name: string, exceptKey: string): string {
  const where: string[] = [];
  for (const key of caseKeys()) {
    if (key === exceptKey) continue;
    const r = state.C[key];
    if (!r?.patient?.name) continue;
    for (const def of TD) for (const row of def.r) if ((r.teams?.[def.k]?.[row.k] || []).includes(name)) where.push(`OT ${caseIndex(key)} ${def.l}`);
  }
  return [...new Set(where)].slice(0, 2).join(", ");
}

async function loadHistory(force = false): Promise<void> {
  if (!force && state.historyRows.length && Date.now() - state.historyLoadedAt < 60_000) return;
  state.historyLoading = true;
  state.historyError = "";
  if (state.currentTab === "hist") render();
  try {
    const data = await apiRequest<HistoryResponse>("/history");
    state.historyRows = (data.sessions || []).map((s) => ({ ...s, full: false }));
    state.historyLoadedAt = Date.now();
  } catch (error) {
    state.historyError = errorMessage(error);
    if (state.historyRows.length) toast(`Couldn't refresh history: ${state.historyError}`, "error");
  } finally {
    state.historyLoading = false;
    if (state.currentTab === "hist") render();
  }
}

function freshCase(): CaseRecord {
  return defaultCase(state.cfg);
}

function roomHasData(key: string): boolean {
  const r = state.C[key];
  if (!r) return false;
  return JSON.stringify(r) !== JSON.stringify(freshCase());
}

function setSidebar(open: boolean): void {
  const app = maybeId("mainApp");
  app?.classList.toggle("sidebar-open", open);
  maybeId("menuToggle")?.setAttribute("aria-expanded", String(open));
}

// ─────────────────────────────────────────────────────────────

export const actions = {
  // Navigation ------------------------------------------------
  go(tab: AppTab): void {
    if (tab !== state.currentTab) state.selectedProcRoom = "";
    state.currentTab = tab;
    setSidebar(false);
    if (tab === "hist") void loadHistory();
    render();
  },
  openCase(key: string, tab: RosterTab = "patient"): void {
    if (!state.C[key]) return;
    state.selectedCase = key;
    state.selectedRosterTab = tab;
    actions.go("roster");
  },
  pickCase(key: string): void {
    state.selectedCase = key;
    render();
  },
  pickRosterTab(tab: RosterTab): void {
    state.selectedRosterTab = tab;
    render();
    maybeId("rosterSteps")?.scrollIntoView({ block: "nearest" });
  },
  shiftRoom(delta: number): void {
    const keys = caseKeys();
    const i = keys.indexOf(state.selectedCase);
    const next = keys[(i + delta + keys.length) % keys.length];
    if (next) actions.pickCase(next);
  },
  openProcRoom(key: string): void {
    actions.go("rooms");
    state.selectedProcRoom = key;
    render();
    window.setTimeout(() => maybeId(`pr-card-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  },
  openSettings(tab: SettingsTab): void {
    state.cfgTab = tab;
    actions.go("settings");
  },
  toggleSidebar(): void {
    setSidebar(!maybeId("mainApp")?.classList.contains("sidebar-open"));
  },
  closeSidebar(): void {
    setSidebar(false);
  },
  collapseSidebar(): void {
    const app = byId("mainApp");
    app.classList.toggle("sidebar-collapsed");
    try {
      localStorage.setItem("msk_sidebar_collapsed", app.classList.contains("sidebar-collapsed") ? "1" : "0");
    } catch {
      /* ignore */
    }
  },

  // Session ---------------------------------------------------
  async saveNow(manual = true): Promise<void> {
    await saveNow(manual);
  },
  async changeDate(value: string): Promise<void> {
    const next = value || today();
    if (next === state.sessionDate) return;
    if (hasLocalChanges()) {
      const saved = await flushSave();
      if (!saved && !(await confirmDialog({ title: "Unsaved changes", message: "Some changes couldn't be saved. They stay on this device and will sync when you return to this date. Switch anyway?", confirm: "Switch date", tone: "warn" }))) {
        render();
        return;
      }
    }
    state.sessionDate = next;
    state.selectedCase = "case1";
    await loadSession();
    render();
  },
  changeLead(value: string): void {
    state.leadName = value.trim();
    scheduleSave();
    renderChrome();
  },

  // Case fields -----------------------------------------------
  setField(key: string, path: string, raw: string, el?: HTMLElement): void {
    const r = rec(key);
    if (!r) return;
    const value = String(raw ?? "").trim();
    const validator = el?.dataset.validate ? VALIDATORS[el.dataset.validate] : undefined;
    showFieldError(el, validator ? validator(value) : "");
    if (getPath(r as unknown as Rec, path) === value) return;
    setPath(r as unknown as Rec, path, value);
    scheduleSave();
    if (RERENDER_PATHS.has(path)) renderSoon();
    else renderChrome();
  },
  setChoice(key: string, path: string, value: string): void {
    const r = rec(key);
    if (!r) return;
    setPath(r as unknown as Rec, path, value);
    scheduleSave();
    render();
  },
  toggleChoice(key: string, path: string, value: string): void {
    const r = rec(key);
    if (!r) return;
    setPath(r as unknown as Rec, path, getPath(r as unknown as Rec, path) === value ? "" : value);
    scheduleSave();
    render();
  },
  toggleArea(key: string, area: string): void {
    const r = rec(key);
    if (!r) return;
    const list = r.assessment.recipientArea.split(",").map((s) => s.trim()).filter(Boolean);
    const next = list.includes(area) ? list.filter((a) => a !== area) : [...list, area];
    r.assessment.recipientArea = next.join(", ");
    scheduleSave();
    render();
  },
  togglePreOp(key: string, checkKey: string): void {
    const r = rec(key);
    if (!r) return;
    r.preOp[checkKey] = !r.preOp[checkKey];
    scheduleSave();
    render();
  },

  async clearRoom(key: string): Promise<void> {
    const r = rec(key);
    if (!r) return;
    if (caseView(key).total.startMs !== null) {
      toast("This case has recorded procedure times. Discharge it instead.", "error");
      return;
    }
    const ok = await confirmDialog({
      title: `Clear OT ${caseIndex(key)}?`,
      message: `This removes ${r.patient.name || "the patient"} and every entry for this room. It can't be undone.`,
      confirm: "Clear room",
      kind: "danger",
      tone: "danger",
    });
    if (!ok) return;
    state.C[key] = freshCase();
    state.selectedRosterTab = "patient";
    scheduleSave(0);
    render();
    toast(`OT ${caseIndex(key)} cleared.`, "success");
  },

  // Timers ----------------------------------------------------
  async startPhase(key: string, phase: LivePhase): Promise<void> {
    await once(`${key}:${phase}`, async () => {
      const r = rec(key);
      if (!r) return;
      const label = PHASE_LABEL[phase];
      let v = caseView(key);
      let check = checkStart(r, phase, state.sessionDate, v.preOp.done, v.preOp.total);
      if (!check.ok) {
        toast(check.reason, "error");
        return;
      }
      if (check.endsActive || check.warnings.length) {
        const running = check.endsActive;
        const body = `<p>${label} starts now.</p>
          ${running ? `<div class="dlg-callout">${icon("stop")}<span><b>${PHASE_LABEL[running]}</b> is running (${fmtClock(spanMs(v.spans[running]))}) and will end at the same moment.</span></div>` : ""}
          ${check.warnings.map((w) => `<div class="dlg-callout warn">${icon("warn")}<span>${E(w)}</span></div>`).join("")}`;
        const ok = await confirmDialog({ title: `Start ${label}?`, body, confirm: running ? `End ${PHASE_LABEL[running]} & start ${label}` : `Start ${label}`, tone: check.warnings.length ? "warn" : "default" });
        if (!ok) return;
        // Re-validate: another device may have changed the case while the dialog was open.
        v = caseView(key);
        check = checkStart(r, phase, state.sessionDate, v.preOp.done, v.preOp.total);
        if (!check.ok) {
          toast(check.reason, "error");
          render();
          return;
        }
      }
      const now = Date.now();
      applyStart(r, phase, now, check.endsActive);
      scheduleSave(0);
      render();
      toast(`${label} started at ${fmtTime(now)}.`, "success");
    });
  },

  async endPhase(key: string, phase: LivePhase): Promise<void> {
    await once(`${key}:${phase}`, async () => {
      const r = rec(key);
      if (!r) return;
      const label = PHASE_LABEL[phase];
      const pre = checkEnd(r, phase, state.sessionDate, Date.now());
      if (!pre.ok) {
        toast(pre.reason, "error");
        return;
      }
      const g = graftStats(r);
      const extra =
        phase === "extraction"
          ? `<div class="dlg-callout">${icon("graft")}<span>Extracted grafts recorded: <b class="num">${g.extracted.toLocaleString()}</b>${g.estimate ? ` of ${g.estimate.toLocaleString()} estimated` : ""}.</span></div>`
          : phase === "placing"
            ? `<div class="dlg-callout${g.placed !== g.extracted ? " warn" : ""}">${icon("graft")}<span>Placed <b class="num">${g.placed.toLocaleString()}</b> of <b class="num">${g.extracted.toLocaleString()}</b> extracted.</span></div>`
            : "";
      const ok = await confirmDialog({
        title: `End ${label}?`,
        body: `<p>Started ${fmtTime(pre.startMs)} · running <b class="num">${fmtDur(Date.now() - pre.startMs)}</b>. It will be recorded as ending now.</p>${extra}`,
        confirm: `End ${label}`,
        kind: "primary",
      });
      if (!ok) return;
      const now = Date.now();
      const check = checkEnd(r, phase, state.sessionDate, now);
      if (!check.ok) {
        toast(check.reason, "error");
        render();
        return;
      }
      applyEnd(r, phase, now);
      scheduleSave(0);
      render();
      toast(`${label} ended · ${fmtDur(now - check.startMs)}.`, "success");
    });
  },

  async editPhase(key: string, phase: LivePhase): Promise<void> {
    const r = rec(key);
    if (!r) return;
    const label = PHASE_LABEL[phase];
    const v = caseView(key);
    const span = v.spans[phase];
    const st = v.states[phase];
    const result = await dialog({
      title: `${label} times`,
      body: `<p class="muted">Correct a time recorded late or by mistake. Leave End empty if the phase is still running.</p>
        ${span.approx ? `<div class="dlg-callout">${icon("info")}<span>These times were recorded before exact timestamps and are accurate to the minute.</span></div>` : ""}
        <div class="grid g-2">
          <div class="field"><label for="edStart">Start</label><input id="edStart" name="start" type="datetime-local" value="${toLocalInput(span.startMs)}" max="${toLocalInput(Date.now())}"></div>
          <div class="field"><label for="edEnd">End</label><input id="edEnd" name="end" type="datetime-local" value="${toLocalInput(span.endMs)}" max="${toLocalInput(Date.now())}"></div>
        </div>`,
      actions: [
        ...(st !== "idle" ? [{ label: "Clear phase", value: "clear", kind: "danger" as const }] : []),
        { label: "Cancel", value: "cancel", kind: "ghost" },
        { label: "Save times", value: "save", kind: "primary", validate: true },
      ],
      validate: (root) => {
        const s = fromLocalInput(dialogValue(root, "start"));
        const e = fromLocalInput(dialogValue(root, "end"));
        const c = checkEdit(r, phase, s, e, state.sessionDate, Date.now());
        return c.ok ? null : c.reason;
      },
    });
    if (!result || result.value === "cancel") return;
    if (result.value === "clear") {
      const ok = await confirmDialog({ title: `Clear ${label}?`, message: `This removes the recorded ${label} start and end times. Use it only to undo a phase started by mistake.`, confirm: "Clear times", kind: "danger", tone: "danger" });
      if (!ok) return;
      applyClear(r, phase);
      scheduleSave(0);
      render();
      toast(`${label} times cleared.`);
      return;
    }
    const s = fromLocalInput(dialogValue(result.root, "start"));
    const e = fromLocalInput(dialogValue(result.root, "end"));
    const c = checkEdit(r, phase, s, e, state.sessionDate, Date.now());
    if (!c.ok || s === null) {
      toast(c.ok ? "Enter a start time." : c.reason, "error");
      return;
    }
    applyEdit(r, phase, s, e);
    scheduleSave(0);
    render();
    toast(`${label} times updated.`, "success");
  },

  // Grafts ----------------------------------------------------
  adjGraft(key: string, group: "extraction" | "placing", field: string, delta: number): void {
    const r = rec(key);
    if (!r) return;
    const g = r.procedure[group] as unknown as Record<string, number>;
    const next = Math.max(0, (Number(g[field]) || 0) + delta);
    if (next === g[field]) return;
    g[field] = next;
    scheduleSave();
    render();
  },
  async setGraftExact(key: string, group: "extraction" | "placing", field: string): Promise<void> {
    const r = rec(key);
    if (!r) return;
    const g = r.procedure[group] as unknown as Record<string, number>;
    const label = field === "grafts" ? "Extracted grafts" : `${field[0].toUpperCase()}${field.slice(1)} placed`;
    const result = await dialog({
      title: label,
      body: `<div class="field"><label for="grExact">Count</label><input id="grExact" name="count" type="number" inputmode="numeric" min="0" max="20000" step="1" value="${Number(g[field]) || 0}" autofocus></div>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Set count", value: "ok", kind: "primary", validate: true },
      ],
      validate: (root) => (/^\d{1,5}$/.test(dialogValue(root, "count")) && Number(dialogValue(root, "count")) <= 20000 ? null : "Enter a whole number between 0 and 20,000."),
      onOpen: (root) => root.querySelector<HTMLInputElement>("#grExact")?.select(),
    });
    if (result?.value !== "ok") return;
    g[field] = Number(dialogValue(result.root, "count"));
    scheduleSave();
    render();
  },
  setGraftStep(step: number): void {
    graftPrefs.step = step;
    render();
  },

  // Teams -----------------------------------------------------
  setTeamView(mode: "stage" | "staff"): void {
    setTeamViewMode(mode);
    render();
  },
  async pickStaff(key: string, teamKey: string, rowKey: string): Promise<void> {
    const r = rec(key);
    if (!r) return;
    const def = TD.find((t) => t.k === teamKey);
    const row = def?.r.find((x) => x.k === rowKey);
    if (!def || !row) return;
    if (!state.cfg.staff.length) {
      toast("Add staff in Settings first.", "error");
      return;
    }
    const current = r.teams?.[teamKey]?.[rowKey] || [];
    const result = await dialog({
      title: `${def.l}${def.r.length > 1 ? ` · ${row.l}` : ""}`,
      wide: false,
      body: `<label class="picker-search">${icon("search")}<input id="pickSearch" placeholder="Filter staff" aria-label="Filter staff" autocomplete="off" autofocus></label>
        <ul class="picker" id="pickList">
          ${state.cfg.staff
            .map((name, i) => {
              const hint = staffHint(name, key);
              const on = current.includes(name);
              return `<li data-name="${E(name.toLowerCase())}"><label class="pick-row"><input type="checkbox" name="pick" value="${i}" ${on ? "checked" : ""}>${avatar(name)}<span class="pick-name">${E(name)}</span>${hint ? `<span class="pick-hint">${E(hint)}</span>` : ""}</label></li>`;
            })
            .join("")}
        </ul>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Save assignment", value: "ok", kind: "primary" },
      ],
      onOpen: (root) => {
        const search = root.querySelector<HTMLInputElement>("#pickSearch");
        search?.addEventListener("input", () => {
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll<HTMLElement>("#pickList li").forEach((li) => {
            li.hidden = Boolean(q) && !(li.dataset.name || "").includes(q);
          });
        });
      },
    });
    if (result?.value !== "ok") return;
    const picked = Array.from(result.root.querySelectorAll<HTMLInputElement>('input[name="pick"]:checked')).map((el) => state.cfg.staff[Number(el.value)]).filter(Boolean);
    const next = [...current.filter((n) => picked.includes(n) || !state.cfg.staff.includes(n)), ...picked.filter((n) => !current.includes(n))];
    if (!r.teams[teamKey]) r.teams[teamKey] = {};
    r.teams[teamKey][rowKey] = next;
    scheduleSave();
    render();
  },
  removeMember(key: string, teamKey: string, rowKey: string, index: number): void {
    const list = state.C[key]?.teams?.[teamKey]?.[rowKey];
    if (!list?.[index]) return;
    const [name] = list.splice(index, 1);
    scheduleSave();
    render();
    toast(`${name} removed.`);
  },
  async copyTeams(key: string): Promise<void> {
    const sources = caseKeys().filter((k) => k !== key && TD.some((t) => Object.values(state.C[k]?.teams?.[t.k] || {}).some((l) => l?.length)));
    if (!sources.length) {
      toast("No other room has teams assigned yet.", "error");
      return;
    }
    const result = await dialog({
      title: "Copy teams from another room",
      body: `<p class="muted">Replaces every team assignment in OT ${caseIndex(key)}.</p>
        <div class="field"><label for="copyFrom">Copy from</label><select id="copyFrom" name="from">${sources.map((k) => `<option value="${k}">OT ${caseIndex(k)} · ${E(state.C[k].patient.name || roomName(caseIndex(k)))}</option>`).join("")}</select></div>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Copy teams", value: "ok", kind: "primary" },
      ],
    });
    if (result?.value !== "ok") return;
    const from = dialogValue(result.root, "from");
    const r = rec(key);
    if (!r || !state.C[from]) return;
    r.teams = JSON.parse(JSON.stringify(state.C[from].teams));
    scheduleSave();
    render();
    toast(`Teams copied from OT ${caseIndex(from)}.`, "success");
  },
  async resetTeams(key: string): Promise<void> {
    const r = rec(key);
    if (!r) return;
    if (!(await confirmDialog({ title: "Reset teams?", message: `Replace all assignments in OT ${caseIndex(key)} with the default team template?`, confirm: "Reset teams", tone: "warn" }))) return;
    r.teams = defaultTeams();
    scheduleSave();
    render();
  },

  // Discharge -------------------------------------------------
  async discharge(key: string): Promise<void> {
    await once(`discharge:${key}`, async () => {
      const r = rec(key);
      if (!r) return;
      const v = caseView(key);
      if (!v.registered) {
        toast("No patient is registered in this room.", "error");
        return;
      }
      if (v.active) {
        toast(`${PHASE_LABEL[v.active]} is still running. End it before discharge.`, "error");
        return;
      }
      const notes: string[] = [];
      if (v.states.dressing === "idle") notes.push("Dressing has no recorded times.");
      if (v.preOp.done < v.preOp.total) notes.push(`Pre-op checklist ended at ${v.preOp.done} / ${v.preOp.total}.`);
      if (!r.postOp.prescriptions) notes.push("No prescriptions recorded.");
      if (!r.postOp.followUpDate) notes.push("No follow-up date set.");
      if (v.grafts.placed > v.grafts.extracted) notes.push("Placed grafts exceed extracted grafts.");
      const g = v.grafts;
      const ok = await confirmDialog({
        title: `Complete case · ${r.patient.name}`,
        tone: notes.length ? "warn" : "success",
        kind: "success",
        confirm: "Complete & discharge",
        body: `<p class="muted">OT ${v.index} · ${E(r.assessment.procedureType || "—")} · ${E(stageLabel(v))}</p>
          ${durationSummary(v, true)}
          <div class="dlg-grafts"><span>Extracted <b class="num">${g.extracted.toLocaleString()}</b></span><span>Placed <b class="num">${g.placed.toLocaleString()}</b></span><span>Hairline ${g.hairline} · Middle ${g.middle} · Crown ${g.crown}</span></div>
          ${notes.map((n) => `<div class="dlg-callout warn">${icon("warn")}<span>${E(n)}</span></div>`).join("")}
          <p class="muted small">The case moves to today's completed records and OT ${v.index} becomes free.</p>`,
      });
      if (!ok) return;
      if (caseView(key).active) {
        toast("A phase was started meanwhile. Discharge cancelled.", "error");
        return;
      }
      const now = Date.now();
      const archived = JSON.parse(JSON.stringify(r)) as CaseRecord;
      archived.status = "completed";
      archived.procedure.currentPhase = "postOp";
      if (!archived.postOp.dischargeTime) archived.postOp.dischargeTime = hhmm(now);
      state.cfg.completedCases = [
        ...(state.cfg.completedCases || []),
        { roomKey: key, roomName: roomName(v.index), dischargedAt: archived.postOp.dischargeTime, dischargedAtIso: new Date(now).toISOString(), record: archived },
      ];
      state.C[key] = freshCase();
      state.selectedRosterTab = "patient";
      scheduleSave(0);
      render();
      toast(`${archived.patient.name} discharged. OT ${v.index} is free.`, "success");
    });
  },

  // OT rooms --------------------------------------------------
  async addRoom(): Promise<void> {
    if (state.cc >= 99) {
      toast("Maximum of 99 rooms.", "error");
      return;
    }
    const n = state.cc + 1;
    const result = await dialog({
      title: `Add OT ${n}`,
      body: `<div class="grid g-2">
        <div class="field"><label for="roomNew">Room name</label><input id="roomNew" name="name" value="${E(state.cfg.rooms[n - 1] || `OT Room ${n}`)}" autofocus></div>
        <div class="field"><label for="roomLeadNew">Room lead</label><input id="roomLeadNew" name="lead" list="staffList" value="${E(state.cfg.roomLeads[n - 1] || "")}" placeholder="Optional"></div>
      </div>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Add room", value: "ok", kind: "primary" },
      ],
    });
    if (result?.value !== "ok") return;
    state.cc = n;
    state.cfg.rooms[n - 1] = dialogValue(result.root, "name") || `OT Room ${n}`;
    state.cfg.roomLeads[n - 1] = dialogValue(result.root, "lead");
    ensureCases();
    state.selectedCase = `case${n}`;
    scheduleSave();
    render();
    toast(`OT ${n} added.`, "success");
  },
  async removeRoom(): Promise<void> {
    if (state.cc <= 1) return;
    const key = `case${state.cc}`;
    const hasData = roomHasData(key);
    const ok = await confirmDialog({
      title: `Remove OT ${state.cc}?`,
      message: hasData ? `OT ${state.cc} has patient data. It will be hidden, not deleted, and returns if you add the room back.` : `OT ${state.cc} will be removed from today's session.`,
      confirm: "Remove room",
      kind: hasData ? "danger" : "primary",
      tone: hasData ? "warn" : "default",
    });
    if (!ok) return;
    state.cc -= 1;
    if (caseIndex(state.selectedCase) > state.cc) state.selectedCase = `case${state.cc}`;
    scheduleSave();
    render();
  },
  setRoomName(index: number, value: string): void {
    const v = value.trim();
    if (!v) {
      toast("Room names can't be empty.", "error");
      render();
      return;
    }
    state.cfg.rooms[index] = v;
    scheduleSave();
    renderChrome();
  },
  setRoomLead(index: number, value: string): void {
    state.cfg.roomLeads[index] = value.trim();
    scheduleSave();
    renderChrome();
  },

  // Procedure rooms ------------------------------------------
  async prAssign(key: string): Promise<void> {
    const room = state.PR[key];
    if (!room) return;
    const procs = state.cfg.procedures;
    const result = await dialog({
      title: room.patient.name ? `Edit · ${prName(Number(key.slice(2)))}` : `Assign patient · ${prName(Number(key.slice(2)))}`,
      body: `<div class="grid g-2">
        <div class="field span-2"><label for="prName">Patient name <span class="req">*</span></label><input id="prName" name="name" value="${E(room.patient.name)}" autofocus></div>
        <div class="field"><label for="prContact">Contact</label><input id="prContact" name="contact" type="tel" value="${E(room.patient.contact)}"></div>
        <div class="field"><label for="prProc">Procedure</label><select id="prProc" name="procedure"><option value="">Select</option>${[...new Set([...procs, room.procedure].filter(Boolean))].map((p) => `<option ${p === room.procedure ? "selected" : ""}>${E(p)}</option>`).join("")}</select></div>
        <div class="field"><label for="prStaff">Assigned staff</label><select id="prStaff" name="assignee"><option value="">Unassigned</option>${[...new Set([...state.cfg.staff, room.assignee].filter(Boolean))].map((s) => `<option ${s === room.assignee ? "selected" : ""}>${E(s)}</option>`).join("")}</select></div>
        <div class="field span-2"><label for="prNotes">Notes</label><input id="prNotes" name="notes" value="${E(room.notes)}"></div>
      </div>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: room.patient.name ? "Save" : "Assign to room", value: "ok", kind: "primary", validate: true },
      ],
      validate: (root) => {
        if (!dialogValue(root, "name")) return "Patient name is required.";
        return validContact(dialogValue(root, "contact")) || null;
      },
    });
    if (result?.value !== "ok") return;
    const name = dialogValue(result.root, "name");
    const samePatient = name === room.patient.name;
    room.patient = { ...room.patient, name, contact: dialogValue(result.root, "contact") };
    if (!samePatient) {
      delete room.patient.startedAt;
      delete room.patient.endedAt;
    }
    room.procedure = dialogValue(result.root, "procedure");
    room.assignee = dialogValue(result.root, "assignee");
    room.notes = dialogValue(result.root, "notes");
    if (room.status === "available") room.status = "occupied";
    scheduleSave();
    render();
  },
  async prStart(key: string): Promise<void> {
    await once(`pr:${key}`, async () => {
      const room = state.PR[key];
      if (!room?.patient.name) {
        toast("Assign a patient first.", "error");
        return;
      }
      if (room.patient.startedAt) {
        toast("The procedure is already running.", "error");
        return;
      }
      const now = Date.now();
      room.patient.startedAt = new Date(now).toISOString();
      delete room.patient.endedAt;
      room.status = "occupied";
      scheduleSave(0);
      render();
      toast(`Procedure started at ${fmtTime(now)}.`, "success");
    });
  },
  async prComplete(key: string): Promise<void> {
    await once(`pr:${key}`, async () => {
      const room = state.PR[key];
      const start = isoMs(room?.patient.startedAt);
      if (!room || start === null) {
        toast("The procedure hasn't started.", "error");
        return;
      }
      if (!(await confirmDialog({ title: "Complete procedure?", body: `<p>${E(room.patient.name)} · started ${fmtTime(start)} · <b class="num">${fmtDur(Date.now() - start)}</b></p><p class="muted">The room moves to “awaiting turnover”.</p>`, confirm: "Complete procedure" }))) return;
      const now = Date.now();
      if (now < start) {
        toast("This device's clock is earlier than the start time.", "error");
        return;
      }
      room.patient.endedAt = new Date(now).toISOString();
      room.status = "completed";
      scheduleSave(0);
      render();
      toast(`Procedure completed · ${fmtDur(now - start)}.`, "success");
    });
  },
  async prTurnover(key: string): Promise<void> {
    const room = state.PR[key];
    if (!room) return;
    const ok = await confirmDialog({ title: "Turnover complete?", message: `${room.patient.name || "The patient"}'s record moves to “Completed today” and the room becomes available.`, confirm: "Room is ready" });
    if (!ok) return;
    const idx = Number(key.slice(2));
    if (room.patient.name) {
      const { queue: _q, ...rest } = JSON.parse(JSON.stringify(room)) as ProcedureRoom;
      state.cfg.completedProcedureRooms = [...(state.cfg.completedProcedureRooms || []), { roomKey: key, roomName: prName(idx), clearedAt: new Date().toISOString(), room: rest }];
    }
    const queue = room.queue;
    state.PR[key] = { ...defaultProcedureRoom(), assignee: room.assignee, queue };
    scheduleSave(0);
    render();
  },
  async queueAdd(key: string): Promise<void> {
    const room = state.PR[key];
    if (!room) return;
    const result = await dialog({
      title: `Add to queue · ${prName(Number(key.slice(2)))}`,
      body: `<div class="grid g-2">
        <div class="field span-2"><label for="qName">Patient name <span class="req">*</span></label><input id="qName" name="name" autofocus></div>
        <div class="field"><label for="qContact">Contact</label><input id="qContact" name="contact" type="tel"></div>
        <div class="field"><label for="qProc">Procedure</label><select id="qProc" name="procedure"><option value="">Select</option>${state.cfg.procedures.map((p) => `<option>${E(p)}</option>`).join("")}</select></div>
        <div class="field span-2"><label for="qNotes">Notes</label><input id="qNotes" name="notes"></div>
      </div>`,
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Add to queue", value: "ok", kind: "primary", validate: true },
      ],
      validate: (root) => (!dialogValue(root, "name") ? "Patient name is required." : validContact(dialogValue(root, "contact")) || null),
    });
    if (result?.value !== "ok") return;
    room.queue.push({
      patient: { name: dialogValue(result.root, "name"), contact: dialogValue(result.root, "contact"), age: "", gender: "", bloodGroup: "", allergies: "" },
      procedure: dialogValue(result.root, "procedure"),
      notes: dialogValue(result.root, "notes"),
      addedAt: new Date().toISOString(),
    });
    scheduleSave();
    render();
  },
  async queueRemove(key: string, i: number): Promise<void> {
    const room = state.PR[key];
    const item = room?.queue?.[i];
    if (!item) return;
    if (!(await confirmDialog({ title: "Remove from queue?", message: `${item.patient.name} will be removed from the waiting queue.`, confirm: "Remove", kind: "danger" }))) return;
    room.queue.splice(room.queue.indexOf(item), 1);
    scheduleSave();
    render();
  },
  queueMove(key: string, i: number, dir: number): void {
    const q = state.PR[key]?.queue;
    const j = i + dir;
    if (!q || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    scheduleSave();
    render();
  },
  async queueCall(key: string, i: number): Promise<void> {
    const room = state.PR[key];
    const item = room?.queue?.[i];
    if (!room || !item) return;
    if (room.status !== "available") {
      toast("The room isn't free yet. Complete the current procedure and turnover first.", "error");
      return;
    }
    if (room.patient.name && !(await confirmDialog({ title: "Replace patient?", message: `${room.patient.name} is still listed in this room. Replace with ${item.patient.name}?`, confirm: "Replace", tone: "warn" }))) return;
    room.patient = { ...item.patient };
    room.procedure = item.procedure;
    room.notes = item.notes;
    room.status = "occupied";
    room.queue.splice(i, 1);
    scheduleSave();
    render();
    toast(`${item.patient.name} called in.`, "success");
  },

  // Settings --------------------------------------------------
  addCfg(type: "staff" | "procedures", inputId: string): void {
    const input = maybeId<HTMLInputElement>(inputId);
    const value = input?.value.trim() || "";
    if (!value) return;
    if (state.cfg[type].some((x) => x.toLowerCase() === value.toLowerCase())) {
      toast(`“${value}” already exists.`, "error");
      return;
    }
    state.cfg[type].push(value);
    scheduleSave();
    render();
    maybeId(inputId)?.focus();
  },
  async removeCfg(type: "staff" | "procedures" | "checks", index: number): Promise<void> {
    const label = type === "checks" ? state.cfg.checks[index]?.l : state.cfg[type][index];
    if (label === undefined) return;
    const what = type === "staff" ? "staff member" : type === "procedures" ? "procedure" : "checklist item";
    if (!(await confirmDialog({ title: `Remove ${what}?`, message: `Remove “${label}”? Existing records that mention it keep their data.`, confirm: "Remove", kind: "danger" }))) return;
    state.cfg[type].splice(index, 1);
    scheduleSave();
    render();
  },
  async renameCfg(type: "staff" | "procedures" | "procRooms", index: number, raw: string): Promise<void> {
    const value = raw.trim();
    const old = state.cfg[type][index];
    if (value === old) return;
    if (!value || state.cfg[type].some((x, i) => i !== index && x.toLowerCase() === value.toLowerCase())) {
      toast(value ? `“${value}” already exists.` : "Name can't be empty.", "error");
      render();
      return;
    }
    state.cfg[type][index] = value;
    if (type === "staff") {
      for (const key of Object.keys(state.C)) {
        const teams = state.C[key].teams || {};
        for (const rows of Object.values(teams)) for (const list of Object.values(rows)) list.forEach((n, i) => n === old && (list[i] = value));
      }
      state.cfg.roomLeads = state.cfg.roomLeads.map((n) => (n === old ? value : n));
      if (state.leadName === old) state.leadName = value;
      for (const room of Object.values(state.PR)) if (room.assignee === old) room.assignee = value;
    }
    if (type === "procedures") {
      for (const r of Object.values(state.C)) if (r.assessment.procedureType === old) r.assessment.procedureType = value;
    }
    scheduleSave();
    renderChrome();
  },
  async resetCfg(type: "staff" | "procedures" | "checks"): Promise<void> {
    if (!(await confirmDialog({ title: "Reset to defaults?", message: "This replaces the current list with the original defaults.", confirm: "Reset", tone: "warn" }))) return;
    if (type === "staff") state.cfg.staff = [...DEF_STAFF];
    if (type === "procedures") state.cfg.procedures = [...DEF_PROCS];
    if (type === "checks") state.cfg.checks = DEF_CHECKS.map((c) => ({ ...c }));
    scheduleSave();
    render();
    toast("Defaults restored.", "success");
  },
  addCheck(): void {
    const label = maybeId<HTMLInputElement>("newCheckLabel")?.value.trim() || "";
    const desc = maybeId<HTMLInputElement>("newCheckDesc")?.value.trim() || "";
    if (!label) return;
    if (state.cfg.checks.some((c) => c.l.toLowerCase() === label.toLowerCase())) {
      toast("That checklist item already exists.", "error");
      return;
    }
    state.cfg.checks.push({ k: `chk_${Date.now()}`, l: label, s: desc });
    scheduleSave();
    render();
    maybeId("newCheckLabel")?.focus();
  },
  editCheck(index: number, field: "l" | "s", value: string): void {
    const c = state.cfg.checks[index];
    if (!c) return;
    if (field === "l" && !value.trim()) {
      toast("Checklist label can't be empty.", "error");
      render();
      return;
    }
    c[field] = value.trim();
    scheduleSave();
  },
  moveCheck(index: number, dir: number): void {
    const list = state.cfg.checks;
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    scheduleSave();
    render();
  },
  addProcRoom(): void {
    const n = state.cfg.procRooms.length + 1;
    state.cfg.procRooms.push(DEF_PROC_ROOMS[n - 1] || `Procedure Room ${n}`);
    ensureCases();
    scheduleSave();
    render();
  },
  async removeProcRoom(): Promise<void> {
    const n = state.cfg.procRooms.length;
    if (n <= 1) return;
    const room = state.PR[`pr${n}`];
    const busyRoom = room && (room.status !== "available" || room.queue.length);
    if (!(await confirmDialog({ title: `Remove ${prName(n)}?`, message: busyRoom ? "This room has a patient or queue. It will be hidden, not deleted, and returns if you add the room back." : "The room will be removed from the list.", confirm: "Remove", kind: busyRoom ? "danger" : "primary" }))) return;
    state.cfg.procRooms.pop();
    scheduleSave();
    render();
  },
  setClinicField(field: "clinicName" | "clinicPhone" | "clinicEmail", value: string): void {
    state.cfg[field] = value.trim();
    scheduleSave();
    renderChrome();
  },

  // Live floor ------------------------------------------------
  setLiveFilter(f: LiveFilter): void {
    setLiveFilter(f);
    render();
  },

  // History ---------------------------------------------------
  setHistoryFilter(name: keyof typeof historyFilter, value: string): void {
    historyFilter[name] = value;
    render();
  },
  clearHistoryFilters(): void {
    for (const k of Object.keys(historyFilter) as Array<keyof typeof historyFilter>) historyFilter[k] = "";
    render();
  },
  async refreshHistory(): Promise<void> {
    await loadHistory(true);
  },
  async openHistoryCase(date: string, ref: string): Promise<void> {
    let idx = state.historyRows.findIndex((s) => s.date === date);
    if (idx < 0) return;
    let session = state.historyRows[idx];
    if (ref.startsWith("c:") && !session.full) {
      try {
        const data = await apiRequest<{ session?: LoadedSession }>(`/history?date=${encodeURIComponent(date)}`);
        if (data.session) {
          idx = state.historyRows.findIndex((s) => s.date === date);
          session = { ...data.session, full: true };
          if (idx >= 0) state.historyRows[idx] = session;
        }
      } catch (error) {
        toast(`Showing a partial record: ${errorMessage(error)}`, "error");
      }
    }
    const entry = sessionEntries(session).find((e) => e.ref === ref);
    if (!entry) {
      toast("That record is no longer available.", "error");
      return;
    }
    await dialog({
      title: entry.patient || "Record",
      wide: true,
      body: caseSummaryHtml(entry, session),
      actions: [{ label: "Close", value: "close", kind: "primary" }],
    });
  },
  async openHistorySession(date: string): Promise<void> {
    if (date === state.sessionDate) {
      actions.go("dash");
      return;
    }
    const ok = await confirmDialog({ title: "Open this session?", message: `Opens ${fmtDateLong(date)} in the workspace. Changes you make there are saved to that date. Use “Go to today” in the top bar to return.`, confirm: "Open session" });
    if (!ok) return;
    await actions.changeDate(date);
    actions.go("dash");
  },

  // Search ----------------------------------------------------
  async openSearch(): Promise<void> {
    const items: Array<{ label: string; sub: string; run: () => void }> = [];
    for (const key of caseKeys()) {
      const v = caseView(key);
      items.push({ label: v.record.patient.name ? `${v.record.patient.name}` : `OT ${v.index}`, sub: `OT ${v.index} · ${v.room} · ${stageLabel(v)}`, run: () => actions.openCase(key, v.active ? "procedure" : "patient") });
    }
    procRoomKeys().forEach((key, i) => {
      const room = state.PR[key];
      items.push({ label: room?.patient.name || prName(i + 1), sub: `${prName(i + 1)}${room?.procedure ? ` · ${room.procedure}` : ""}`, run: () => actions.openProcRoom(key) });
      room?.queue.forEach((q) => items.push({ label: q.patient.name, sub: `Queue · ${prName(i + 1)}`, run: () => actions.openProcRoom(key) }));
    });
    (state.cfg.completedCases || []).forEach((c) => items.push({ label: c.record.patient.name, sub: `Discharged today · ${c.roomName}`, run: () => actions.go("hist") }));
    let filtered = items;
    const renderList = (root: HTMLElement) => {
      const list = root.querySelector<HTMLElement>("#searchList");
      if (!list) return;
      list.innerHTML = filtered.length
        ? filtered.map((it, i) => `<li><button type="button" class="search-hit" data-i="${i}"><strong>${E(it.label)}</strong><span>${E(it.sub)}</span></button></li>`).join("")
        : `<li class="muted small search-none">No matches</li>`;
      list.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) =>
        b.addEventListener("click", () => {
          const it = filtered[Number(b.dataset.i)];
          closeDialog();
          it?.run();
        }),
      );
    };
    await dialog({
      title: "Search",
      body: `<label class="picker-search">${icon("search")}<input id="searchInput" placeholder="Patient, room or queue" autocomplete="off" aria-label="Search" autofocus></label><ul class="search-list" id="searchList"></ul>`,
      actions: [{ label: "Close", value: "close" }],
      onOpen: (root) => {
        renderList(root);
        const input = root.querySelector<HTMLInputElement>("#searchInput");
        input?.addEventListener("input", () => {
          const q = input.value.trim().toLowerCase();
          filtered = q ? items.filter((it) => `${it.label} ${it.sub}`.toLowerCase().includes(q)) : items;
          renderList(root);
        });
        input?.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && filtered[0]) {
            e.preventDefault();
            e.stopPropagation();
            const it = filtered[0];
            closeDialog();
            it.run();
          }
        });
      },
    });
  },

  // Auth ------------------------------------------------------
  async login(): Promise<void> {
    const err = byId("logErr");
    err.textContent = "";
    const btn = byId<HTMLButtonElement>("loginBtn");
    const email = byId<HTMLInputElement>("logEmail").value.trim().toLowerCase();
    const password = byId<HTMLInputElement>("logPass").value;
    if (!email || !password) {
      err.textContent = "Enter your email and password.";
      return;
    }
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.textContent = "Signing in…";
    try {
      const user = await signIn(email, password);
      try {
        const remember = maybeId<HTMLInputElement>("rememberMe");
        if (remember?.checked) localStorage.setItem("msk_duty_remember_email", email);
        else localStorage.removeItem("msk_duty_remember_email");
      } catch {
        /* ignore */
      }
      byId<HTMLInputElement>("logPass").value = "";
      await startApp(user);
    } catch (error) {
      err.textContent = /invalid login/i.test(errorMessage(error)) ? "Email or password is incorrect." : errorMessage(error);
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.textContent = "Sign in";
    }
  },
  async logout(): Promise<void> {
    if (hasLocalChanges()) {
      const saved = await flushSave();
      if (!saved && !(await confirmDialog({ title: "Unsaved changes", message: "Some changes couldn't be saved yet. They stay on this device and sync next time you sign in here. Sign out anyway?", confirm: "Sign out", tone: "warn" }))) return;
    } else if (!(await confirmDialog({ title: "Sign out?", message: "You'll need to sign in again to continue.", confirm: "Sign out" }))) return;
    try {
      await signOut();
    } catch {
      /* ignore */
    }
    showLogin();
  },
};

export type Actions = typeof actions;

declare global {
  interface Window {
    dsa: Actions;
  }
}

export function showLogin(message = ""): void {
  stopSync();
  state.curUser = null;
  byId("mainApp").classList.remove("on", "sidebar-open");
  byId("loginScreen").hidden = false;
  byId("logErr").textContent = message;
  byId<HTMLInputElement>(byId<HTMLInputElement>("logEmail").value ? "logPass" : "logEmail").focus();
}

export async function startApp(user: User): Promise<void> {
  state.curUser = user;
  byId("loginScreen").hidden = true;
  const app = byId("mainApp");
  app.classList.add("on");
  byId("view").innerHTML = `<div class="page"><div class="panel"><div class="panel-body"><div class="skeleton-group"><div class="skeleton" style="width:40%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div></div></div></div>`;
  state.sessionDate = today();
  await loadSession();
  if (!state.curUser) return;
  render();
  startSync();
}

export function handleAuthLost(): void {
  showLogin("Your session expired. Sign in again; unsaved changes on this device will be restored.");
}

