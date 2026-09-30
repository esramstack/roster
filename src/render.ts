import type { User } from "@supabase/supabase-js";
import { apiRequest, getSessionUser, signIn, signOut } from "./api";
import {
  DEF_CHECKS,
  DEF_PROCS,
  DEF_ROOMS,
  DEF_STAFF,
  defaultCase,
  ensureCases,
  graftTotal,
  mergeLoadedConfig,
  phaseIndex,
  PH,
  PHL,
  placedTotal,
  preOpCount,
  prName,
  roomName,
  sessionPayload,
  state,
  statusInfo,
  TD,
  today,
} from "./state";
import type {
  AppTab,
  CaseRecord,
  DashboardDetail,
  HistoryResponse,
  LoadedSession,
  Phase,
  ProcedureRoom,
  ProcedureRoomStatus,
  ProcedureQueueItem,
  RosterTab,
  SettingsTab,
} from "./types";
import { icon } from "./ui/icons";
import { initMskControls, mskSelect, mskTime } from "./ui/controls";
import {
  emptyState as markupEmptyState,
  metricCard,
  pageStack,
  sectionCard,
  subPanel,
} from "./ui/markup";

const REMEMBER_EMAIL_KEY = "msk_duty_remember_email";
let historyFilterQuery = "";
let dashboardFilterQuery = "";

const PAGE_META: Record<AppTab, { title: string; crumb: string; blurb: string }> = {
  dash: {
    title: "Dashboard",
    crumb: "Operations",
    blurb: "Session overview, room pipeline, and quick access to active cases.",
  },
  roster: {
    title: "Roster",
    crumb: "Operations",
    blurb: "Patient registration, pre-op checks, teams, and post-op discharge.",
  },
  live: {
    title: "Live Floor",
    crumb: "Operations",
    blurb: "Track anaesthesia through dressing with precise Start and End controls.",
  },
  settings: {
    title: "Settings",
    crumb: "System",
    blurb: "Staff, rooms, procedures, checklist, and clinic profile.",
  },
  hist: {
    title: "History",
    crumb: "System",
    blurb: "Browse saved sessions, expand clinical detail, and reload a day.",
  },
};

type MutableRecord = Record<string, unknown>;
type LivePhase = "anaesthesia" | "extraction" | "placing" | "dressing";

interface DsaActions {
  go(tab: AppTab): void;
  saveNow(showToast?: boolean): Promise<void>;
  changeRoomCount(value: string): Promise<void>;
  addRoom(): void;
  closeRoomModal(): void;
  submitRoomModal(): void;
  removeRoom(): Promise<void>;
  changeDate(value: string): Promise<void>;
  changeLead(value: string): void;
  showDashboardDetail(detail: DashboardDetail): void;
  pickCase(key: string): void;
  pickRosterTab(tab: RosterTab): void;
  setField(path: string, value: string): void;
  setCaseField(caseKey: string, path: string, value: string): void;
  togglePreOp(key: string): void;
  advance(key: string, phase: Phase): void;
  startPhase(caseKey: string, phase: LivePhase): void;
  endPhase(caseKey: string, phase: LivePhase, next: Phase): void;
  addMember(teamKey: string, rowKey: string, name: string): void;
  removeMember(teamKey: string, rowKey: string, index: number): Promise<void>;
  addMemberForCase(caseKey: string, teamKey: string, rowKey: string, name: string): void;
  removeMemberForCase(caseKey: string, teamKey: string, rowKey: string, index: number): Promise<void>;
  adj(key: string, group: "extraction" | "placing", field: string, delta: number): void;
  openRosterItem(key: string, tab?: RosterTab): void;
  setProcedureRoomField(roomKey: string, path: string, value: string): void;
  addProcedureQueuePatient(roomKey: string): void;
  removeProcedureQueuePatient(roomKey: string, index: number): Promise<void>;
  moveQueuePatientToRoom(roomKey: string, index: number): Promise<void>;
  pickSettingsTab(tab: SettingsTab): void;
  addCfg(type: "staff" | "procedures", inputId: string): void;
  removeCfg(type: "staff" | "procedures" | "checks", index: number): Promise<void>;
  resetCfg(type: "staff" | "rooms" | "procedures" | "checks"): Promise<void>;
  addCheck(): void;
  setConfigArrayValue(type: "rooms" | "procRooms", index: number, value: string): void;
  setRoomLead(index: number, value: string): void;
  setClinicField(field: "clinicName" | "clinicPhone" | "clinicEmail", value: string): void;
  dischargeSelectedCase(): Promise<void>;
  openHistorySession(date: string): Promise<void>;
  toggleHistoryDetail(date: string): Promise<void>;
  toggleLiveCard(key: string): void;
  filterHistory(query: string): void;
  filterDashboard(query: string): void;
  login(): Promise<void>;
  logout(): Promise<void>;
}

declare global {
  interface Window {
    dsa: DsaActions;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function inputValue(id: string): string {
  return byId<HTMLInputElement>(id).value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unexpected error");
}

export function E(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function tick(): void {
  const now = new Date();
  byId("clk").textContent = now.toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  byId("ckd").textContent = now.toLocaleDateString("en-PK", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function toast(message: string, kind: "info" | "success" | "error" = "info"): void {
  const t = byId("toast");
  const iconGlyph = kind === "success" ? "✓" : kind === "error" ? "!" : "i";
  const title = kind === "success" ? "Success" : kind === "error" ? "Something went wrong" : "Notice";
  t.dataset.kind = kind;
  t.innerHTML = `<span class="toast-accent" aria-hidden="true"></span>
    <span class="toast-ico" aria-hidden="true">${iconGlyph}</span>
    <span class="toast-copy">
      <strong class="toast-title">${E(title)}</strong>
      <span class="toast-msg">${E(message)}</span>
    </span>`;
  t.classList.remove("show");
  // restart animation
  void t.offsetWidth;
  t.classList.add("show");
  window.clearTimeout((t as HTMLElement & { _toastTimer?: number })._toastTimer);
  (t as HTMLElement & { _toastTimer?: number })._toastTimer = window.setTimeout(() => t.classList.remove("show"), 2800);
}

let confirmResolver: ((value: boolean) => void) | null = null;

let confirmKeyHandler: ((event: KeyboardEvent) => void) | null = null;

function confirmAction(message: string, title = "Please confirm"): Promise<boolean> {
  return new Promise((resolve) => {
    if (confirmResolver) resolveConfirm(false);
    confirmResolver = resolve;
    const host = byId("confirmHost");
    host.hidden = false;
    host.classList.add("on");
    host.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div class="dialog-icon warn">${icon("warn")}</div>
      <h3 id="confirmTitle">${E(title)}</h3>
      <p>${E(message)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" id="confirmCancelBtn">Cancel</button>
        <button type="button" class="btn primary" id="confirmOkBtn">Confirm</button>
      </div>
    </div>`;
    byId("confirmCancelBtn").addEventListener("click", () => resolveConfirm(false));
    byId("confirmOkBtn").addEventListener("click", () => resolveConfirm(true));
    byId("confirmOkBtn").focus();
    confirmKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") resolveConfirm(false);
      if (event.key === "Enter") resolveConfirm(true);
    };
    window.addEventListener("keydown", confirmKeyHandler);
  });
}

function resolveConfirm(value: boolean): void {
  if (confirmKeyHandler) {
    window.removeEventListener("keydown", confirmKeyHandler);
    confirmKeyHandler = null;
  }
  const host = document.getElementById("confirmHost");
  if (host) {
    host.classList.remove("on");
    host.hidden = true;
    host.innerHTML = "";
  }
  const resolver = confirmResolver;
  confirmResolver = null;
  resolver?.(value);
}

function showAuthOverlay(title: string, body: string, ms = 1100): Promise<void> {
  return new Promise((resolve) => {
    const overlay = byId("authOverlay");
    overlay.hidden = false;
    overlay.classList.add("on");
    overlay.innerHTML = `<div class="auth-success-card">
      <div class="check-burst">✓</div>
      <h3>${E(title)}</h3>
      <p>${E(body)}</p>
    </div>`;
    window.setTimeout(() => {
      overlay.classList.remove("on");
      overlay.hidden = true;
      overlay.innerHTML = "";
      resolve();
    }, ms);
  });
}

const SAVE_DEBOUNCE_MS = 800;
const SAVE_RETRY_MS = 200;

function idleSaveLabel(el: HTMLElement): string {
  return el.dataset.manualSaveLabel === "true" ? "Changes save automatically" : "";
}

function updateSaveStatus(): void {
  const labels: Record<typeof state.saveStatus, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving...",
    saved: "Saved",
    error: state.saveError || "Save failed",
  };
  document.querySelectorAll<HTMLElement>(".save-status").forEach((el) => {
    el.textContent = state.saveStatus === "idle" ? idleSaveLabel(el) : labels[state.saveStatus];
    el.className = `save-status ${state.saveStatus}`;
  });
  updateStickySave();
  renderSessionBar();
}

function clearSaveTimer(): void {
  if (state.saveTimer !== null) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
}

function hasPendingSave(): boolean {
  return state.saveStatus === "dirty" || state.saveStatus === "error" || state.saveTimer !== null || state.saving;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function isValidNonNegativeInteger(value: string): boolean {
  return value === "" || (/^\d+$/.test(value) && Number(value) >= 0);
}

function isLikelyContact(value: string): boolean {
  return value === "" || /^[+()\d\s-]{7,20}$/.test(value);
}

function normalizeNumberString(value: string): string {
  if (value.trim() === "") return "";
  return String(Math.max(0, Math.floor(Number(value) || 0)));
}

function validateSessionForSave(): string[] {
  const errors: string[] = [];
  if (!isValidDate(state.sessionDate)) errors.push("Session date is invalid.");
  if (state.cc < 1 || state.cc > 99) errors.push("Room count must be between 1 and 99.");

  for (let i = 1; i <= state.cc; i += 1) {
    const record = state.C[`case${i}`];
    if (!record) continue;
    if (!isValidNonNegativeInteger(record.patient.age)) errors.push(`${roomName(i)} patient age must be a positive number.`);
    if (!isLikelyContact(record.patient.contact)) errors.push(`${roomName(i)} patient contact looks invalid.`);
    if (!isValidNonNegativeInteger(record.assessment.graftEstimate)) errors.push(`${roomName(i)} graft estimate must be a positive number.`);
  }

  for (const [key, room] of Object.entries(state.PR)) {
    if (!isLikelyContact(room.patient.contact)) errors.push(`${key.toUpperCase()} patient contact looks invalid.`);
  }

  return errors;
}

function setSaveError(message: string): void {
  state.saveStatus = "error";
  state.saveError = message;
  updateSaveStatus();
  toast(message);
}

async function loadSession(): Promise<void> {
  clearSaveTimer();
  state.loading = true;
  try {
    const data = await apiRequest<LoadedSession>(`/sessions?date=${encodeURIComponent(state.sessionDate)}`);
    state.cc = Number(data.cc || 4);
    state.C = data.C && Object.keys(data.C).length ? data.C : {};
    state.PR = data.PR && Object.keys(data.PR).length ? data.PR : state.PR;
    mergeLoadedConfig(data.cfg);
    state.sessionDate = data.date || state.sessionDate;
    state.leadName = data.lead || "";
    ensureRoomNames(state.cc);
    ensureCases();
    state.saveStatus = "idle";
    state.saveError = "";
  } catch (error) {
    toast(errorMessage(error) || "Could not load session");
    ensureCases();
  } finally {
    state.loading = false;
  }
}

async function saveNow(showToast = false): Promise<void> {
  if (state.loading || !state.curUser) return;
  clearSaveTimer();
  if (state.saving) {
    state.saveStatus = "dirty";
    updateSaveStatus();
    scheduleSave(true);
    return;
  }

  const validationErrors = validateSessionForSave();
  if (validationErrors.length) {
    setSaveError(validationErrors[0]);
    return;
  }

  state.saving = true;
  state.saveStatus = "saving";
  state.saveError = "";
  updateSaveStatus();
  try {
    await apiRequest<LoadedSession>("/sessions", {
      method: "POST",
      body: JSON.stringify(sessionPayload()),
    });
    state.saveError = "";
    // Edits during the request mark dirty / queue a timer — re-save those instead of claiming success on a stale payload.
    if (state.saveStatus !== "saving" || state.saveTimer !== null) {
      if (state.saveTimer === null) scheduleSave(true);
    } else {
      state.saveStatus = "saved";
      if (showToast) toast("Saved to Supabase", "success");
    }
  } catch (error) {
    state.saveStatus = "error";
    state.saveError = errorMessage(error) || "Could not save";
    toast(state.saveError, "error");
  } finally {
    state.saving = false;
    updateSaveStatus();
  }
}

function scheduleSave(_silent?: boolean): void {
  clearSaveTimer();
  state.saveStatus = "dirty";
  state.saveError = "";
  updateSaveStatus();
  state.saveTimer = window.setTimeout(() => {
    state.saveTimer = null;
    if (state.saving) {
      state.saveTimer = window.setTimeout(() => {
        state.saveTimer = null;
        void saveNow(true);
      }, SAVE_RETRY_MS);
      return;
    }
    void saveNow(true);
  }, SAVE_DEBOUNCE_MS);
}

async function flushSave(): Promise<boolean> {
  clearSaveTimer();
  while (state.saving) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, SAVE_RETRY_MS));
  }
  if (state.saveStatus === "dirty" || state.saveStatus === "error") {
    await saveNow(true);
  }
  return state.saveStatus === "saved" || state.saveStatus === "idle";
}

function setActiveTab(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.classList.toggle("on", tab.dataset.tab === state.currentTab);
  });
  const meta = PAGE_META[state.currentTab];
  const title = document.getElementById("pageTitle");
  const crumb = document.getElementById("pageCrumb");
  if (title) title.textContent = meta.title;
  if (crumb) crumb.textContent = meta.crumb;
  updateStickySave();
}

function renderSessionBar(): void {
  const host = document.getElementById("sessionBar");
  if (!host || !state.curUser) {
    if (host) host.innerHTML = "";
    return;
  }
  const roomOptions = Array.from({ length: Math.max(10, state.cc) }, (_, index) => index + 1);
  host.innerHTML = `<div class="command-bar">
    <div class="toolbar-group room-manager">
      <span class="label">Rooms</span>
      ${mskSelect({
        value: String(state.cc),
        choices: roomOptions.map((n) => ({ value: String(n), label: String(n) })),
        commit: "changeRoomCount",
        className: "room-select",
      })}
      <button class="btn primary compact" onclick="dsa.addRoom()">${icon("plus")} Add Room</button>
      <button class="btn ghost compact" ${state.cc <= 1 ? "disabled" : ""} onclick="void dsa.removeRoom()">Remove Room</button>
    </div>
    <div class="toolbar-group">
      <span class="label">Date</span>
      <input class="inline-input date-input" type="date" value="${E(state.sessionDate)}" onchange="void dsa.changeDate(this.value)">
    </div>
    <div class="toolbar-group lead-group">
      <span class="label">Lead</span>
      <input class="inline-input lead-input" value="${E(state.leadName)}" placeholder="Type lead name..." onchange="dsa.changeLead(this.value)">
    </div>
    <div class="toolbar-group save-group">
      <button class="btn primary compact" ${state.saving ? "disabled" : ""} onclick="void dsa.saveNow(true)">${state.saving ? "Saving..." : `${icon("save")} Save Now`}</button>
      <span id="saveStatus" class="save-status ${state.saveStatus}">${state.saveStatus === "idle" ? "" : E(state.saveStatus === "error" ? state.saveError : state.saveStatus === "saving" ? "Saving..." : state.saveStatus === "dirty" ? "Unsaved changes" : "Saved")}</span>
    </div>
  </div>${roomModal()}`;
}

function pageIntro(tab: AppTab = state.currentTab): string {
  if (tab === "dash") return "";
  const meta = PAGE_META[tab];
  return `<div class="page-intro"><p>${E(meta.blurb)}</p></div>`;
}

function updateStickySave(): void {
  const bar = document.getElementById("stickySave");
  if (!bar) return;
  const show = state.saveStatus === "dirty" || state.saveStatus === "error";
  bar.classList.toggle("on", show && Boolean(state.curUser));
  const label = bar.querySelector("span");
  if (label) {
    label.textContent = state.saveStatus === "error"
      ? (state.saveError || "Save failed")
      : "Unsaved changes";
  }
}

function emptyState(title: string, body: string, actionHtml = ""): string {
  return markupEmptyState(title, body, actionHtml);
}

function saveStatusLabel(): string {
  if (state.saveStatus === "idle") return "Changes save automatically";
  if (state.saveStatus === "error") return state.saveError;
  if (state.saveStatus === "saving") return "Saving...";
  if (state.saveStatus === "dirty") return "Unsaved changes";
  return "Saved";
}

function injectShellIcons(): void {
  document.querySelectorAll<HTMLElement>("[data-ico]").forEach((node) => {
    const name = node.dataset.ico || "dash";
    node.innerHTML = icon(name);
  });
}

function applyRememberedEmail(): void {
  try {
    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (saved) {
      const email = byId<HTMLInputElement>("logEmail");
      email.value = saved;
      const remember = document.getElementById("rememberMe") as HTMLInputElement | null;
      if (remember) remember.checked = true;
    }
  } catch {
    /* ignore storage errors */
  }
}

function persistRememberedEmail(email: string): void {
  try {
    const remember = document.getElementById("rememberMe") as HTMLInputElement | null;
    if (remember?.checked && email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    /* ignore storage errors */
  }
}

function closeMobileSidebar(): void {
  byId("mainApp").classList.remove("sidebar-open");
}

function toggleMobileSidebar(): void {
  const app = byId("mainApp");
  app.classList.toggle("sidebar-open");
  const open = app.classList.contains("sidebar-open");
  const toggle = byId("menuToggle");
  toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncMobileNavMode(): void {
  if (window.matchMedia("(min-width: 981px)").matches) {
    closeMobileSidebar();
  }
}

function toggleSidebarCollapse(): void {
  byId("mainApp").classList.toggle("sidebar-collapsed");
}

function updateLiveBadge(): void {
  let active = 0;
  for (let i = 1; i <= state.cc; i += 1) {
    const record = state.C[`case${i}`];
    if (record && phaseIndex(record.procedure.currentPhase) > 0 && record.status !== "completed") active += 1;
  }
  byId("lbdg").textContent = String(active);
}

function render(): void {
  ensureCases();
  updateLiveBadge();
  setActiveTab();
  renderSessionBar();
  const renderers: Record<AppTab, () => void | Promise<void>> = {
    dash: renderDashboard,
    roster: renderRoster,
    live: renderLive,
    settings: renderSettings,
    hist: renderHistory,
  };
  void renderers[state.currentTab]();
}

function roomModal(): string {
  if (!state.roomModalOpen) return "";
  const nextRoomNumber = state.cc + 1;
  return `<div class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h2>Add / Update OT Room</h2>
          <p>Add any room number, including numbers larger than 10.</p>
        </div>
        <button class="modal-close" onclick="dsa.closeRoomModal()">x</button>
      </div>
      <div class="grid3">
        <div class="field"><label>Room Number</label><input id="roomNumberInput" type="number" min="1" value="${nextRoomNumber}"></div>
        <div class="field"><label>Room Name</label><input id="roomNameInput" value="OT Room ${nextRoomNumber}" placeholder="OT Room ${nextRoomNumber}"></div>
        <div class="field"><label>Room Lead</label><input id="roomLeadInput" placeholder="Type room lead"></div>
      </div>
      <div class="panel-actions">
        <button class="btn primary" onclick="dsa.submitRoomModal()">Add / Update Room</button>
        <button class="btn ghost" onclick="dsa.closeRoomModal()">Cancel</button>
      </div>
    </div>
  </div>`;
}

function roomLead(index: number): string {
  return state.cfg.roomLeads?.[index - 1] || "";
}

function savePanelActions(label = "Save Changes"): string {
  return `<div class="panel-actions">
    <button class="btn ghost" ${state.saving ? "disabled" : ""} onclick="void dsa.saveNow(true)">${state.saving ? "Saving..." : label}</button>
    <span class="save-status ${state.saveStatus}" data-manual-save-label="true">${E(saveStatusLabel())}</span>
  </div>`;
}

function dashboardDetailPanel(): string {
  if (state.dashboardDetail === "hidden") return "";
  type DashboardCaseRow = {
    key: string;
    roomIndex: number;
    record: CaseRecord;
    archived?: boolean;
    archivedRoomName?: string;
  };

  const detailLabels: Record<DashboardDetail, string> = {
    hidden: "Dashboard Details",
    rooms: "Room Details",
    active: "Active Cases",
    done: "Completed Cases",
    grafts: "Graft Summary",
  };
  const detailHelp: Record<DashboardDetail, string> = {
    hidden: "",
    rooms: "Review every OT room, patient registration, and current stage.",
    active: "Cases currently moving through the live procedure workflow.",
    done: "Patients marked completed or discharged for this date.",
    grafts: "Extracted and placed graft totals by room.",
  };

  const visibleCases: DashboardCaseRow[] = Array.from({ length: state.cc }, (_, index) => {
    const roomIndex = index + 1;
    const key = `case${roomIndex}`;
    return { key, roomIndex, record: state.C[key] };
  });
  const archivedCases: DashboardCaseRow[] = (state.cfg.completedCases || []).map((entry, index) => ({
    key: `archive${index}`,
    roomIndex: Number(entry.roomKey.replace("case", "")) || index + 1,
    record: entry.record,
    archivedRoomName: entry.roomName,
    archived: true,
  }));

  const filteredCases = [...visibleCases, ...archivedCases].filter(({ record, archived, archivedRoomName, roomIndex }) => {
    if (state.dashboardDetail === "active") {
      if (!(phaseIndex(record.procedure.currentPhase) > 0 && record.status !== "completed")) return false;
    } else if (state.dashboardDetail === "done") {
      if (!(archived || record.status === "completed")) return false;
    } else if (state.dashboardDetail === "rooms") {
      if (archived) return false;
    }

    const q = dashboardFilterQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      archivedRoomName || roomName(roomIndex),
      record.patient.name,
      record.assessment.procedureType,
      roomLead(roomIndex),
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });

  const rows = filteredCases.map(({ key, roomIndex, record, archivedRoomName, archived }) => {
    const [statusClass, statusLabel] = statusInfo(record);
    const extracted = Number(record.procedure.extraction.grafts || 0);
    const placed = placedTotal(record);
    const primaryMetric = state.dashboardDetail === "grafts"
      ? `${extracted.toLocaleString()} extracted / ${placed.toLocaleString()} placed`
      : PHL[record.procedure.currentPhase] || "Waiting";

    return `<div class="dash-detail-row ${archived ? "archived" : ""}" ${archived ? "" : `onclick="dsa.openRosterItem('${key}', 'patient')"`} role="button" title="${archived ? "Discharged case archive" : `Open ${E(roomName(roomIndex))} roster`}">
      <div>
        <strong>${E(archivedRoomName || roomName(roomIndex))}${archived ? " - Discharged" : ""}</strong>
        <div class="muted">${E(record.patient.name || "No patient registered")} ${record.assessment.procedureType ? `- ${E(record.assessment.procedureType)}` : ""}${!archived && roomLead(roomIndex) ? ` - Lead: ${E(roomLead(roomIndex))}` : ""}</div>
      </div>
      <div class="dash-detail-metric">${primaryMetric}</div>
      <span class="pill ${statusClass}">${statusLabel}</span>
      <div class="dash-detail-actions">
        ${archived ? `<span class="pill done">Archived</span>` : `<button class="btn ghost compact" onclick="event.stopPropagation(); dsa.openRosterItem('${key}', 'patient')">Roster</button><button class="btn primary compact" onclick="event.stopPropagation(); dsa.go('live')">Live</button>`}
      </div>
    </div>`;
  }).join("");

  return `<div class="dash-detail-panel">
    <div class="dash-detail-head">
      <div>
        <h3>${detailLabels[state.dashboardDetail]}</h3>
        <p>${detailHelp[state.dashboardDetail]}</p>
      </div>
      <div class="dash-detail-tabs">
        ${(["rooms", "active", "done", "grafts"] as DashboardDetail[]).map((detail) => `<button class="${state.dashboardDetail === detail ? "on" : ""}" onclick="dsa.showDashboardDetail('${detail}')">${detailLabels[detail].replace(" Details", "").replace(" Cases", "")}</button>`).join("")}
        <button class="hide-detail-btn" onclick="dsa.showDashboardDetail('hidden')">Hide Details</button>
      </div>
    </div>
    <div class="filter-bar">
      <input class="inline-input" type="search" placeholder="Filter rooms or patients..." value="${E(dashboardFilterQuery)}" oninput="dsa.filterDashboard(this.value)">
    </div>
    <div class="dash-detail-body">
      ${rows || emptyState("No matching cases", "Try another filter or register a patient on the Roster tab.")}
    </div>
  </div>`;
}

function renderDashboard(): void {
  let active = 0;
  let done = state.cfg.completedCases?.length || 0;
  let grafts = (state.cfg.completedCases || []).reduce((sum, entry) => sum + graftTotal(entry.record), 0);

  for (let i = 1; i <= state.cc; i += 1) {
    const record = state.C[`case${i}`];
    if (record.status === "completed") done += 1;
    else if (phaseIndex(record.procedure.currentPhase) > 0) active += 1;
    grafts += graftTotal(record);
  }

  const pipeline = Array.from({ length: state.cc }, (_, idx) => {
    const i = idx + 1;
    const record = state.C[`case${i}`];
    const [cls, label] = statusInfo(record);
    const cur = phaseIndex(record.procedure.currentPhase);
    return `<button class="card blue click-card" onclick="dsa.pickCase('case${i}'); dsa.go('roster')">
      <div class="row" style="justify-content:space-between">
        <div>
          <strong>${roomName(i)}</strong>
          <div class="muted">${E(record.patient.name || "Not registered")} ${record.assessment.graftEstimate ? `- ${E(record.assessment.graftEstimate)} grafts` : ""}${roomLead(i) ? ` - Lead: ${E(roomLead(i))}` : ""}</div>
        </div>
        <span class="pill ${cls}">${label}</span>
      </div>
      <div class="row" style="margin-top:10px">
        ${PH.map((phase, phaseIndexValue) => `<span class="pill ${phaseIndexValue < cur ? "done" : phaseIndexValue === cur ? "active" : "scheduled"}">${PHL[phase]}</span>`).join("")}
      </div>
    </button>`;
  }).join("");

  const procedureRooms = [1, 2].map((i) => {
    const room = state.PR[`pr${i}`];
    const cls = room.status === "completed" ? "done" : room.status === "occupied" ? "active" : "scheduled";
    return `<button class="card teal click-card" onclick="dsa.pickCase('pr${i}'); dsa.go('roster')">
      <div class="row" style="justify-content:space-between"><strong>${prName(i)}</strong><span class="pill ${cls}">${E(room.status)}</span></div>
      <div class="muted" style="margin-top:8px">${E(room.patient.name || "No patient assigned")}${room.assignee ? ` - ${E(room.assignee)}` : ""}</div>
    </button>`;
  }).join("");

  byId("view").innerHTML = pageStack([
    sectionCard({
      title: "Session metrics",
      subtitle: "Tap a metric to open the matching detail list.",
      body: `<div class="metric-grid">
        ${metricCard({ value: state.cc, label: "Rooms", hint: "Show room details", onClick: "dsa.showDashboardDetail('rooms')", active: state.dashboardDetail === "rooms", className: "tone-ink" })}
        ${metricCard({ value: active, label: "Active", hint: "Show active cases", onClick: "dsa.showDashboardDetail('active')", active: state.dashboardDetail === "active", className: "tone-gold" })}
        ${metricCard({ value: done, label: "Done", hint: "Show completed", onClick: "dsa.showDashboardDetail('done')", active: state.dashboardDetail === "done", className: "tone-success" })}
        ${metricCard({ value: grafts.toLocaleString(), label: "Grafts", hint: "Show graft totals", onClick: "dsa.showDashboardDetail('grafts')", active: state.dashboardDetail === "grafts", className: "tone-dark" })}
      </div>
      ${dashboardDetailPanel()}`,
    }),
    sectionCard({
      title: "Case Pipeline",
      subtitle: "Open an OT room to continue roster work.",
      body: pipeline || emptyState("No OT rooms", "Add a room from the command bar to begin the pipeline.", `<div style="margin-top:12px"><button class="btn primary compact" onclick="dsa.addRoom()">Add Room</button></div>`),
    }),
    sectionCard({
      title: "Procedure Rooms",
      subtitle: "Quick status for procedure rooms.",
      body: `<div class="grid2">${procedureRooms}</div>`,
    }),
  ]);
}

function caseTabs(): string {
  let html = `<div class="case-tabs">`;
  for (let i = 1; i <= state.cc; i += 1) {
    const key = `case${i}`;
    const record = state.C[key];
    html += `<button class="case-tab ot-tab ${state.selectedCase === key ? "on" : ""}" onclick="dsa.pickCase('${key}')">
      <div class="ord">OT ${i}</div>
      <div class="name">${E(record.patient.name || "No patient")}</div>
      <div class="tab-sub">${preOpCount(record)}/${state.cfg.checks.length}</div>
    </button>`;
  }

  for (let i = 1; i <= 2; i += 1) {
    const key = `pr${i}`;
    const room = state.PR[key];
    html += `<button class="case-tab pr-tab ${state.selectedCase === key ? "on" : ""}" onclick="dsa.pickCase('${key}')">
      <div class="ord" style="color:var(--teal)">PR ${i}</div>
      <div class="name">${E(room.patient.name || "No patient")}</div>
      <span class="pill ${room.status === "occupied" ? "active" : room.status === "completed" ? "done" : "scheduled"}">${E(room.status)}</span>
      <div class="tab-sub">Queue ${room.queue?.length || 0}</div>
    </button>`;
  }
  return `${html}</div>`;
}

function selectedCase(): CaseRecord {
  const record = state.C[state.selectedCase];
  if (!record) throw new Error(`Missing case ${state.selectedCase}`);
  return record;
}

function selectedProcedureRoom(): ProcedureRoom {
  const room = state.PR[state.selectedCase];
  if (!room) throw new Error(`Missing procedure room ${state.selectedCase}`);
  return room;
}

function renderRoster(): void {
  if (state.selectedCase.startsWith("pr")) {
    renderProcedureRoom();
    return;
  }

  const record = selectedCase();
  const tabButtons = (["patient", "preop", "teams", "postop"] as RosterTab[])
    .map((tab) => `<button class="${state.selectedRosterTab === tab ? "on" : ""}" onclick="dsa.pickRosterTab('${tab}')">${tab === "preop" ? "Pre-Op" : tab.charAt(0).toUpperCase() + tab.slice(1)}</button>`)
    .join("");

  const panels: Record<RosterTab, (record: CaseRecord) => string> = {
    patient: patientPanel,
    preop: preopPanel,
    teams: teamsPanel,
    postop: postopPanel,
  };

  const grafts = Number(record.assessment.graftEstimate || record.procedure.extraction.grafts || 0);
  const startTime = record.startTime || record.procedure.anaesthesia.start || "--:--";
  const preOpsDone = preOpCount(record);
  const preOpDots = state.cfg.checks.map((check) => `<span class="preop-dot ${record.preOp[check.k] ? "done" : ""}"></span>`).join("");

  byId("view").innerHTML = pageStack([
    pageIntro("roster"),
    sectionCard({
      title: "Case selection",
      subtitle: "Choose an OT or procedure room to edit.",
      body: caseTabs(),
    }),
    sectionCard({
      title: "Patient summary",
      body: `<div class="banner roster-banner">
      <div class="roster-patient">
        <h1>${E(record.patient.name || "Patient Not Registered")}</h1>
        <p>${E(record.patient.age || "-")} yrs - ${E(record.patient.gender || "-")} - ${E(record.patient.bloodGroup || "-")} - ${E(record.assessment.procedureType || "-")} ${record.assessment.norwoodScale ? `- ${E(record.assessment.norwoodScale)}` : ""}</p>
      </div>
      <div class="roster-metrics">
        <button class="metric-tile" onclick="dsa.pickRosterTab('patient')"><strong>${grafts.toLocaleString()}</strong><span>Grafts</span></button>
        <button class="metric-tile" onclick="dsa.pickRosterTab('patient')"><strong>${E(startTime)}</strong><span>Start</span></button>
        <button class="metric-tile preop-tile" onclick="dsa.pickRosterTab('preop')"><strong>Pre-Op ${preOpsDone}/${state.cfg.checks.length}</strong><span class="preop-dots">${preOpDots}</span></button>
      </div>
    </div>`,
    }),
    sectionCard({
      title: "Roster details",
      subtitle: "Patient, pre-op, teams, and post-op.",
      body: `<div class="inner-tabs">${tabButtons}</div>${panels[state.selectedRosterTab](record)}`,
    }),
  ]);
}

function patientPanel(record: CaseRecord): string {
  const ageError = !isValidNonNegativeInteger(record.patient.age) ? "Age must be a positive number." : "";
  const contactError = !isLikelyContact(record.patient.contact) ? "Use digits, spaces, +, -, or parentheses." : "";
  const graftError = !isValidNonNegativeInteger(record.assessment.graftEstimate) ? "Graft estimate must be a positive number." : "";
  return `<div class="form-card">
    <div class="form-card-head">
      <h3>Patient profile</h3>
      <p>Demographics, procedure plan, and scheduled times for this OT room.</p>
    </div>
    <div class="form-card-body">
      <div class="form-section">
        <div class="form-section-title">Identity</div>
        <div class="grid2">
          <div class="field"><label>Full Name</label><input value="${E(record.patient.name)}" onchange="dsa.setField('patient.name', this.value); dsa.pickRosterTab('patient')" placeholder="Patient full name"></div>
          <div class="field"><label>Contact</label><input value="${E(record.patient.contact)}" onchange="dsa.setField('patient.contact', this.value); dsa.pickRosterTab('patient')" placeholder="+92 ...">${contactError ? `<div class="field-error">${E(contactError)}</div>` : ""}</div>
        </div>
        <div class="grid3" style="margin-top:12px">
          <div class="field"><label>Age</label><input type="number" min="0" value="${E(record.patient.age)}" onchange="dsa.setField('patient.age', this.value); dsa.pickRosterTab('patient')">${ageError ? `<div class="field-error">${E(ageError)}</div>` : ""}</div>
          <div class="field"><label>Gender</label>${mskSelect({
            value: record.patient.gender,
            choices: [{ value: "", label: "Select gender" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }],
            commit: "setField|patient.gender;pickRosterTab|patient",
            placeholder: "Select gender",
          })}</div>
          <div class="field"><label>Blood Group</label>${mskSelect({
            value: record.patient.bloodGroup,
            choices: [{ value: "", label: "Select" }, ...["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((x) => ({ value: x, label: x }))],
            commit: "setField|patient.bloodGroup;pickRosterTab|patient",
            placeholder: "Select",
          })}</div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Procedure plan</div>
        <div class="grid3">
          <div class="field"><label>Procedure</label>${mskSelect({
            value: record.assessment.procedureType,
            choices: state.cfg.procedures.map((x) => ({ value: x, label: x })),
            commit: "setField|assessment.procedureType;pickRosterTab|patient",
            placeholder: "Select procedure",
          })}</div>
          <div class="field"><label>Baldness Type</label><input value="${E(record.assessment.norwoodScale)}" onchange="dsa.setField('assessment.norwoodScale', this.value)" placeholder="e.g. Type III vertex"><span class="helper">Clinical classification used for planning</span></div>
          <div class="field"><label>Graft Estimate</label><input type="number" min="0" value="${E(record.assessment.graftEstimate)}" onchange="dsa.setField('assessment.graftEstimate', this.value); dsa.pickRosterTab('patient')">${graftError ? `<div class="field-error">${E(graftError)}</div>` : ""}</div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Schedule</div>
        <div class="grid2">
          <div class="field"><label>Start</label>${mskTime({ value: record.startTime, commit: "setField|startTime", title: "Start time" })}</div>
          <div class="field"><label>End</label>${mskTime({ value: record.endTime, commit: "setField|endTime", title: "End time" })}</div>
        </div>
      </div>
      ${savePanelActions("Save Patient")}
    </div>
  </div>`;
}

function preopPanel(record: CaseRecord): string {
  return `<div class="form-card">
    <div class="form-card-head">
      <h3>Pre-operative clearance</h3>
      <p>Record vitals and complete the safety checklist before procedure start.</p>
    </div>
    <div class="form-card-body">
      <div class="form-section">
        <div class="form-section-title">Vitals</div>
        <div class="grid3">
          <div class="field"><label>Blood Pressure</label><input value="${E(record.preOp.bp)}" onchange="dsa.setField('preOp.bp', this.value)" placeholder="e.g. 120/80"></div>
          <div class="field"><label>Pulse</label><input value="${E(record.preOp.pulse)}" onchange="dsa.setField('preOp.pulse', this.value)" placeholder="bpm"></div>
          <div class="field"><label>SpO2</label><input value="${E(record.preOp.spo2)}" onchange="dsa.setField('preOp.spo2', this.value)" placeholder="%"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Checklist</div>
        <div class="checklist-meta">
          <span>${preOpCount(record)} of ${state.cfg.checks.length} complete</span>
          <div class="checklist-meter" aria-hidden="true"><i style="width:${state.cfg.checks.length ? Math.round((preOpCount(record) / state.cfg.checks.length) * 100) : 0}%"></i></div>
        </div>
        <div class="checklist">
          ${state.cfg.checks.map((check) => `<button type="button" class="check ${record.preOp[check.k] ? "done" : ""}" onclick="dsa.togglePreOp('${check.k}')" aria-pressed="${record.preOp[check.k] ? "true" : "false"}"><span class="box" aria-hidden="true">${record.preOp[check.k] ? "✓" : ""}</span><span class="check-copy"><strong>${E(check.l)}</strong><span class="check-desc">${E(check.s)}</span></span></button>`).join("") || emptyState("No checklist items", "Add checklist items in Settings.")}
        </div>
      </div>
      <div class="panel-actions">
        <button class="btn green" onclick="dsa.advance('${state.selectedCase}', 'anaesthesia'); dsa.pickRosterTab('teams')">Clear for Procedure</button>
        <button class="btn ghost" onclick="void dsa.saveNow(true)">Save Pre-Op</button>
      </div>
    </div>
  </div>`;
}

function teamsPanel(record: CaseRecord): string {
  const assignmentControl = (teamKey: string, rowKey: string): string => state.cfg.staff.length
    ? mskSelect({
        value: "",
        choices: [{ value: "", label: "+ Assign" }, ...state.cfg.staff.map((staff) => ({ value: staff, label: staff }))],
        commit: `addMember|${teamKey}|${rowKey}`,
        className: "live-assign",
        placeholder: "+ Assign",
        clearAfter: true,
      })
    : `<span class="empty-inline">Add staff in Settings first.</span>`;
  return `<div class="form-card">
    <div class="form-card-head">
      <h3>Team assignments</h3>
      <p>Assign leads and assistants for each procedural stage.</p>
    </div>
    <div class="form-card-body">
      <div class="grid2">${TD.map((team) => {
        const teamRows = record.teams[team.k] || {};
        return `<div class="card team-card"><strong>${team.l}</strong>${team.r.map((row) => {
          const members = teamRows[row.k] || [];
          return `<div style="margin-top:12px">
            <div class="label">${row.l}</div>
            <div class="chip-list">
              ${members.map((member, index) => `<span class="chip">${E(member)} <button onclick="void dsa.removeMember('${team.k}', '${row.k}', ${index})" aria-label="Remove ${E(member)}">x</button></span>`).join("")}
              ${assignmentControl(team.k, row.k)}
            </div>
          </div>`;
        }).join("")}</div>`;
      }).join("")}</div>
      ${savePanelActions("Save Teams")}
    </div>
  </div>`;
}

function postopPanel(record: CaseRecord): string {
  return `<div class="form-card">
    <div class="form-card-head">
      <h3>Post-operative care</h3>
      <p>Capture discharge instructions, follow-up, and clinical notes.</p>
    </div>
    <div class="form-card-body">
      <div class="form-section">
        <div class="form-section-title">Discharge plan</div>
        <div class="grid3">
          <div class="field"><label>Prescriptions</label><input value="${E(record.postOp.prescriptions)}" onchange="dsa.setField('postOp.prescriptions', this.value)" placeholder="Medications / care kit"></div>
          <div class="field"><label>Follow Up</label><input type="date" value="${E(record.postOp.followUpDate)}" onchange="dsa.setField('postOp.followUpDate', this.value)"></div>
          <div class="field"><label>Discharge</label>${mskTime({ value: record.postOp.dischargeTime, commit: "setField|postOp.dischargeTime", title: "Discharge time" })}</div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Notes</div>
        <div class="field"><label>Clinical notes</label><textarea onchange="dsa.setField('assessment.notes', this.value)" placeholder="Post-op observations...">${E(record.assessment.notes)}</textarea></div>
      </div>
      <div class="panel-actions">
        <button class="btn green" onclick="void dsa.dischargeSelectedCase()">Discharge Patient</button>
        <button class="btn ghost" onclick="void dsa.saveNow(true)">Save Post-Op</button>
      </div>
    </div>
  </div>`;
}

function renderProcedureRoom(): void {
  const room = selectedProcedureRoom();
  const index = Number(state.selectedCase.replace("pr", ""));
  if (!Array.isArray(room.queue)) room.queue = [];
  const queueRows = room.queue.map((item, itemIndex) => `<div class="queue-row">
    <div>
      <strong>${E(item.patient.name || "Unnamed patient")}</strong>
      <div class="muted">${E(item.procedure || "No procedure selected")}${item.patient.contact ? ` - ${E(item.patient.contact)}` : ""}${item.notes ? ` - ${E(item.notes)}` : ""}</div>
    </div>
    <div class="dash-detail-actions">
      <button class="btn primary compact" onclick="void dsa.moveQueuePatientToRoom('${state.selectedCase}', ${itemIndex})">Move to Room</button>
      <button class="btn danger compact" onclick="void dsa.removeProcedureQueuePatient('${state.selectedCase}', ${itemIndex})">Remove</button>
    </div>
  </div>`).join("");
  byId("view").innerHTML = pageStack([
    pageIntro("roster"),
    sectionCard({
      title: "Case selection",
      subtitle: "Choose an OT or procedure room to edit.",
      body: caseTabs(),
    }),
    sectionCard({
      title: prName(index),
      subtitle: `${room.patient.name || "No patient assigned"} · Queue ${room.queue.length}`,
      actions: `<span class="pill ${room.status === "occupied" ? "active" : room.status === "completed" ? "done" : "scheduled"}">${E(room.status)}</span>`,
      body: `<div class="grid3">
        <div class="field"><label>Patient Name</label><input value="${E(room.patient.name)}" onchange="dsa.setProcedureRoomField('${state.selectedCase}', 'patient.name', this.value)"></div>
        <div class="field"><label>Contact</label><input value="${E(room.patient.contact)}" onchange="dsa.setProcedureRoomField('${state.selectedCase}', 'patient.contact', this.value)"></div>
        <div class="field"><label>Status</label>${mskSelect({
          value: room.status,
          choices: (["available", "occupied", "completed"] as ProcedureRoomStatus[]).map((x) => ({ value: x, label: x })),
          commit: `setProcedureRoomField|${state.selectedCase}|status`,
        })}</div>
      </div>
      <div class="grid3" style="margin-top:12px">
        <div class="field"><label>Assignee</label>${mskSelect({
          value: room.assignee,
          choices: [{ value: "", label: "Select" }, ...state.cfg.staff.map((staff) => ({ value: staff, label: staff }))],
          commit: `setProcedureRoomField|${state.selectedCase}|assignee`,
          placeholder: "Select",
        })}</div>
        <div class="field"><label>Procedure</label>${mskSelect({
          value: room.procedure,
          choices: [{ value: "", label: "Select" }, ...state.cfg.procedures.map((procedure) => ({ value: procedure, label: procedure }))],
          commit: `setProcedureRoomField|${state.selectedCase}|procedure`,
          placeholder: "Select",
        })}</div>
        <div class="field"><label>Notes</label><input value="${E(room.notes)}" onchange="dsa.setProcedureRoomField('${state.selectedCase}', 'notes', this.value)"></div>
      </div>
      ${savePanelActions("Save Procedure Room")}`,
    }),
    sectionCard({
      title: "Waiting Queue",
      subtitle: "Patients waiting for this procedure room.",
      body: `<div class="grid3">
        <div class="field"><label>Patient Name</label><input id="${state.selectedCase}QueueName" placeholder="Next patient name"></div>
        <div class="field"><label>Contact</label><input id="${state.selectedCase}QueueContact" placeholder="Contact number"></div>
        <div class="field"><label>Procedure</label>${mskSelect({
          value: "",
          choices: [{ value: "", label: "Select" }, ...state.cfg.procedures.map((procedure) => ({ value: procedure, label: procedure }))],
          commit: "",
          placeholder: "Select",
          inputId: `${state.selectedCase}QueueProcedure`,
        })}</div>
      </div>
      <div class="field"><label>Notes</label><input id="${state.selectedCase}QueueNotes" placeholder="Queue notes..."></div>
      <div class="panel-actions">
        <button class="btn primary" onclick="dsa.addProcedureQueuePatient('${state.selectedCase}')">+ Add to Queue</button>
        <button class="btn ghost" onclick="void dsa.saveNow(true)">Save Queue</button>
      </div>
      <div class="queue-list">${queueRows || `<div class="empty-panel">No patients waiting for this procedure room.</div>`}</div>`,
    }),
  ]);
}

function counter(key: string, group: "extraction" | "placing", field: string): string {
  const record = state.C[key];
  const groupValue = record.procedure[group] as unknown as Record<string, number>;
  const val = groupValue[field] || 0;
  return `<span class="counter"><button onclick="dsa.adj('${key}', '${group}', '${field}', -10)">-</button><span>${val}</span><button onclick="dsa.adj('${key}', '${group}', '${field}', 10)">+</button></span>`;
}

function liveTeamBlocks(caseKey: string, teamKeys: string[]): string {
  const record = state.C[caseKey];
  return teamKeys.map((teamKey) => {
    const definition = TD.find((team) => team.k === teamKey);
    if (!definition) return "";
    const teamRows = record.teams[teamKey] || {};
    return `<div class="live-team-block">
      <div class="live-team-title">${E(definition.l)}</div>
      ${definition.r.map((row) => {
        const members = teamRows[row.k] || [];
        return `<div class="live-team-row">
          <span class="live-team-label">${E(row.l)}</span>
          <div class="chip-list">
            ${members.map((member, index) => `<span class="chip">${E(member)} <button onclick="void dsa.removeMemberForCase('${caseKey}', '${teamKey}', '${row.k}', ${index})" aria-label="Remove ${E(member)}">x</button></span>`).join("")}
            ${state.cfg.staff.length
              ? mskSelect({
                  value: "",
                  choices: [{ value: "", label: "+ Assign" }, ...state.cfg.staff.map((staff) => ({ value: staff, label: staff }))],
                  commit: `addMemberForCase|${caseKey}|${teamKey}|${row.k}`,
                  className: "live-assign",
                  placeholder: "+ Assign",
                  clearAfter: true,
                })
              : `<span class="empty-inline">Add staff in Settings first.</span>`}
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

function liveCaseStatus(record: CaseRecord): ["scheduled" | "active" | "done", string] {
  if (record.status === "completed") return ["done", "Completed"];
  const cur = record.procedure.currentPhase;
  if (cur === "registration" || cur === "preOp") return ["scheduled", "Waiting"];
  if (cur === "postOp") return ["done", "Ended"];

  const phase = cur as LivePhase;
  const phaseData = record.procedure[phase];
  if (phaseData?.start && !phaseData.end) return ["active", "In Progress"];

  const previousLivePhase = (["anaesthesia", "extraction", "placing", "dressing"] as LivePhase[])
    .slice()
    .reverse()
    .find((item) => record.procedure[item].end);
  if (previousLivePhase) return ["done", "Ended"];

  return ["scheduled", "Waiting"];
}

function isLiveCardOpen(key: string, liveStatusClass: string): boolean {
  if (Object.prototype.hasOwnProperty.call(state.liveOpenCases, key)) return state.liveOpenCases[key];
  return liveStatusClass === "active";
}

function renderLive(): void {
  const phases: Array<{ k: LivePhase; next: Phase; l: string; teams: string[] }> = [
    { k: "anaesthesia", next: "extraction", l: "Anaesthesia", teams: ["anaesthesia"] },
    { k: "extraction", next: "placing", l: "Extraction", teams: ["extraction", "arrangement"] },
    { k: "placing", next: "dressing", l: "Placing", teams: ["placing"] },
    { k: "dressing", next: "postOp", l: "Dressing", teams: ["shower", "dressing"] },
  ];

  let inProgress = 0;
  let waiting = 0;
  let completed = 0;
  for (let i = 1; i <= state.cc; i += 1) {
    const [, label] = liveCaseStatus(state.C[`case${i}`]);
    if (label === "In Progress") inProgress += 1;
    else if (label === "Waiting") waiting += 1;
    else completed += 1;
  }
  const prOccupied = [1, 2].filter((i) => state.PR[`pr${i}`].status === "occupied").length;

  const cases = Array.from({ length: state.cc }, (_, idx) => {
    const i = idx + 1;
    const key = `case${i}`;
    const record = state.C[key];
    const cur = record.procedure.currentPhase;
    const [liveStatusClass, liveStatusLabel] = liveCaseStatus(record);
    const open = isLiveCardOpen(key, liveStatusClass);
    const phaseBlocks = phases.map((phase) => {
      const isActive = cur === phase.k;
      const phaseData = record.procedure[phase.k];
      const phaseEnded = Boolean(phaseData.end);
      const isDone = phaseEnded || phaseIndex(cur) > phaseIndex(phase.k);
      const canStart = !phaseEnded;
      const canEnd = Boolean(phaseData.start) && !phaseEnded;
      return `<div class="live-phase-block">
        <div class="phase">
          <div class="phase-click" role="group" aria-label="${phase.l} status">
            <span class="dot ${isDone ? "done" : isActive ? "active" : ""}"></span>
            <span class="phase-meta"><strong>${phase.l}</strong><span class="muted" style="display:block">${E(phaseData.start || "--:--")} → ${E(phaseData.end || "--:--")}</span></span>
            <span class="phase-click-label">${phaseEnded ? "Ended" : isActive ? "In Progress" : "Ready"}</span>
          </div>
          <div class="phase-controls">
            ${mskTime({ value: phaseData.start, commit: `setCaseField|${key}|procedure.${phase.k}.start`, className: "inline-time", title: "Start time" })}
            ${mskTime({ value: phaseData.end, commit: `setCaseField|${key}|procedure.${phase.k}.end`, className: "inline-time", title: "End time" })}
            <button class="btn ghost" ${canStart ? "" : "disabled"} onclick="dsa.startPhase('${key}', '${phase.k}')">${phaseData.start && !phaseEnded ? "Restart" : "Start"}</button>
            <button class="btn primary" ${canEnd ? "" : "disabled"} onclick="dsa.endPhase('${key}', '${phase.k}', '${phase.next}')">End</button>
          </div>
        </div>
        ${liveTeamBlocks(key, phase.teams)}
      </div>`;
    }).join("");

    return `<details class="live-collapse" ${open ? "open" : ""}>
      <summary class="live-card-head" onclick="event.preventDefault(); dsa.toggleLiveCard('${key}')">
        <div>
          <strong>${roomName(i)} - ${E(record.patient.name || "Patient")}</strong>
          <div class="muted">${E(record.assessment.procedureType || "-")} - Est. ${E(record.assessment.graftEstimate || "-")}</div>
        </div>
        <div class="row gap-sm">
          <span class="pill ${liveStatusClass}">${liveStatusLabel}</span>
          <span class="live-card-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
        </div>
      </summary>
      <div class="live-collapse-body">
        ${phaseBlocks}
        ${subPanel({
          title: "Graft counters",
          body: `<div class="live-graft-panel">
            <span class="label">Extracted</span>${counter(key, "extraction", "grafts")}
            <span class="label">Placed</span><strong>${placedTotal(record)}</strong>
            ${(["hairline", "middle", "crown"] as const).map((zone) => `<span class="label">${zone}</span>${counter(key, "placing", zone)}`).join("")}
          </div>`,
        })}
        <div class="live-case-actions">
          <button class="btn primary" onclick="void dsa.saveNow(true)">Save OT ${i}</button>
          <button class="btn ghost" onclick="dsa.openRosterItem('${key}', 'patient')">Open OT ${i} Roster</button>
          <span class="save-status ${state.saveStatus}" data-manual-save-label="true">${E(saveStatusLabel())}</span>
        </div>
      </div>
    </details>`;
  }).join("");

  const rooms = [1, 2].map((i) => {
    const key = `pr${i}`;
    const room = state.PR[key];
    const statusClass = room.status === "occupied" ? "active" : room.status === "completed" ? "done" : "scheduled";
    const open = isLiveCardOpen(key, statusClass);
    return `<details class="live-collapse teal-card" ${open ? "open" : ""}>
      <summary class="live-card-head teal-head" onclick="event.preventDefault(); dsa.toggleLiveCard('${key}')">
        <div>
          <strong>${prName(i)}</strong>
          <div class="muted">Waiting queue: ${room.queue?.length || 0}</div>
        </div>
        <div class="row gap-sm">
          <span class="pill ${statusClass}">${E(room.status)}</span>
          <span class="live-card-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
        </div>
      </summary>
      <div class="live-collapse-body">
        <div class="grid3">
          <div class="field"><label>Patient</label><input class="inline-input" value="${E(room.patient.name)}" placeholder="Patient" onchange="dsa.setProcedureRoomField('${key}', 'patient.name', this.value)"></div>
          <div class="field"><label>Assignee</label>${mskSelect({
            value: room.assignee,
            choices: [{ value: "", label: "Assignee" }, ...state.cfg.staff.map((staff) => ({ value: staff, label: staff }))],
            commit: `setProcedureRoomField|${key}|assignee`,
            className: "inline-select",
            placeholder: "Assignee",
          })}</div>
          <div class="field"><label>Status</label>${mskSelect({
            value: room.status,
            choices: (["available", "occupied", "completed"] as ProcedureRoomStatus[]).map((status) => ({ value: status, label: status })),
            commit: `setProcedureRoomField|${key}|status`,
            className: "inline-select",
          })}</div>
        </div>
      </div>
    </details>`;
  }).join("");

  byId("view").innerHTML = pageStack([
    pageIntro("live"),
    sectionCard({
      title: "Overview",
      subtitle: "Current floor snapshot from live OT and procedure rooms.",
      body: `<div class="metric-grid">
        ${metricCard({ value: inProgress, label: "In Progress", className: "tone-gold" })}
        ${metricCard({ value: waiting, label: "Waiting", className: "tone-ink" })}
        ${metricCard({ value: completed, label: "Ended / Done", className: "tone-success" })}
        ${metricCard({ value: prOccupied, label: "PR Occupied", className: "tone-dark" })}
      </div>`,
    }),
    sectionCard({
      title: "Controls",
      subtitle: "Save all live floor updates for this session.",
      body: `<div class="toolbar-bar">
        <button class="btn primary" ${state.saving ? "disabled" : ""} onclick="void dsa.saveNow(true)">${state.saving ? "Saving..." : "Save Live Updates"}</button>
        <span class="save-status ${state.saveStatus}" data-manual-save-label="true">${E(saveStatusLabel())}</span>
      </div>`,
    }),
    sectionCard({
      title: "Live Cases",
      subtitle: "OT rooms with phase timing, teams, and graft tracking.",
      body: `<div class="live-cases-list">${cases || emptyState("No live OT rooms", "Add rooms on the Dashboard to track procedures.")}</div>`,
    }),
    sectionCard({
      title: "Procedure Rooms",
      subtitle: "Patient, assignee, and status for PR 1–2.",
      body: `<div class="live-room-grid">${rooms}</div>`,
    }),
  ]);
}

function renderSettings(): void {
  let body = "";
  if (state.cfgTab === "staff") {
    body = `<div class="form-card"><div class="form-card-head"><h3>Staff directory</h3><p>People available for OT team assignments.</p></div><div class="form-card-body"><div class="row"><input class="inline-input" id="newStaff" placeholder="Staff name"><button class="btn primary" onclick="dsa.addCfg('staff', 'newStaff')">+ Add</button></div><div class="chip-list" style="margin-top:12px">${state.cfg.staff.map((staff, index) => `<span class="chip">${E(staff)} <button onclick="void dsa.removeCfg('staff', ${index})" aria-label="Remove ${E(staff)}">x</button></span>`).join("") || `<span class="empty-inline">No staff added yet.</span>`}</div><div class="panel-actions"><button class="btn ghost" onclick="void dsa.saveNow(true)">Save Staff</button><button class="btn ghost" onclick="void dsa.resetCfg('staff')">Reset Defaults</button></div></div></div>`;
  }
  if (state.cfgTab === "rooms") {
    const roomSettingCount = Math.max(10, state.cc, state.cfg.rooms.length);
    body = `<div class="form-card"><div class="form-card-head"><h3>Room configuration</h3><p>OT room names, leads, and procedure rooms.</p></div><div class="form-card-body"><div class="grid2">${Array.from({ length: roomSettingCount }, (_, index) => `<div class="room-setting"><div class="field"><label>OT Room ${index + 1}</label><input value="${E(state.cfg.rooms[index] || `OT Room ${index + 1}`)}" onchange="dsa.setConfigArrayValue('rooms', ${index}, this.value)"></div><div class="field"><label>Room Lead</label><input value="${E(state.cfg.roomLeads?.[index] || "")}" placeholder="Lead for OT Room ${index + 1}" onchange="dsa.setRoomLead(${index}, this.value)"></div></div>`).join("")}${[0, 1].map((index) => `<div class="field"><label>Procedure Room ${index + 1}</label><input value="${E(state.cfg.procRooms[index] || "")}" onchange="dsa.setConfigArrayValue('procRooms', ${index}, this.value)"></div>`).join("")}</div><div class="panel-actions"><button class="btn ghost" onclick="void dsa.saveNow(true)">Save Rooms</button><button class="btn ghost" onclick="void dsa.resetCfg('rooms')">Reset Defaults</button></div></div></div>`;
  }
  if (state.cfgTab === "procedures") {
    body = `<div class="form-card"><div class="form-card-head"><h3>Procedure types</h3><p>Options shown on patient and queue forms.</p></div><div class="form-card-body"><div class="row"><input class="inline-input" id="newProc" placeholder="Procedure type"><button class="btn primary" onclick="dsa.addCfg('procedures', 'newProc')">+ Add</button></div><div class="chip-list" style="margin-top:12px">${state.cfg.procedures.map((procedure, index) => `<span class="chip">${E(procedure)} <button onclick="void dsa.removeCfg('procedures', ${index})" aria-label="Remove ${E(procedure)}">x</button></span>`).join("") || `<span class="empty-inline">No procedures added yet.</span>`}</div><div class="panel-actions"><button class="btn ghost" onclick="void dsa.saveNow(true)">Save Procedures</button><button class="btn ghost" onclick="void dsa.resetCfg('procedures')">Reset Defaults</button></div></div></div>`;
  }
  if (state.cfgTab === "checklist") {
    body = `<div class="form-card"><div class="form-card-head"><h3>Pre-op checklist</h3><p>Safety items clinicians must confirm before procedure.</p></div><div class="form-card-body"><div class="grid2"><input class="inline-input" id="newCheckLabel" placeholder="Checklist label"><input class="inline-input" id="newCheckDesc" placeholder="Description"></div><button class="btn primary" style="margin-top:10px" onclick="dsa.addCheck()">+ Add</button><div style="margin-top:12px">${state.cfg.checks.map((check, index) => `<div class="check"><div class="box">✓</div><div style="flex:1"><strong>${E(check.l)}</strong><div style="font-size:12px;color:var(--td)">${E(check.s)}</div></div><button class="btn danger" onclick="void dsa.removeCfg('checks', ${index})">Remove</button></div>`).join("") || `<span class="empty-inline">No checklist items added yet.</span>`}</div><div class="panel-actions"><button class="btn ghost" onclick="void dsa.saveNow(true)">Save Checklist</button><button class="btn ghost" onclick="void dsa.resetCfg('checks')">Reset Defaults</button></div></div></div>`;
  }
  if (state.cfgTab === "clinic") {
    body = `<div class="form-card"><div class="form-card-head"><h3>Clinic profile</h3><p>Contact details shown across the workspace.</p></div><div class="form-card-body"><div class="grid3">
      <div class="field"><label>Clinic Name</label><input value="${E(state.cfg.clinicName)}" onchange="dsa.setClinicField('clinicName', this.value)"></div>
      <div class="field"><label>Phone</label><input value="${E(state.cfg.clinicPhone)}" onchange="dsa.setClinicField('clinicPhone', this.value)"></div>
      <div class="field"><label>Email</label><input value="${E(state.cfg.clinicEmail)}" onchange="dsa.setClinicField('clinicEmail', this.value)"></div>
    </div>${savePanelActions("Save Clinic Info")}</div></div>`;
  }

  byId("view").innerHTML = pageStack([
    pageIntro("settings"),
    sectionCard({
      title: "Settings",
      subtitle: "Configure staff, rooms, procedures, checklist, and clinic profile.",
      body: `<div class="inner-tabs">${(["staff", "rooms", "procedures", "checklist", "clinic"] as SettingsTab[]).map((tab) => `<button class="${state.cfgTab === tab ? "on" : ""}" onclick="dsa.pickSettingsTab('${tab}')">${tab}</button>`).join("")}</div>
      <div class="settings-panel">${body}</div>`,
    }),
  ]);
}

async function renderHistory(force = false): Promise<void> {
  const cacheFresh = !force && state.historyRows.length > 0 && Date.now() - state.historyLoadedAt < 90_000;
  if (!cacheFresh) {
    byId("view").innerHTML = pageStack([
      pageIntro("hist"),
      sectionCard({
        title: "Transplant History",
        body: `<div class="skeleton block"></div><div class="skeleton block"></div><div class="card history-loading">Loading history...</div>`,
      }),
    ]);
    try {
      const data = await apiRequest<HistoryResponse>("/history");
      state.historyRows = data.sessions || [];
      state.historyLoadedAt = Date.now();
    } catch (error) {
      byId("view").innerHTML = pageStack([
        pageIntro("hist"),
        sectionCard({
          title: "Transplant History",
          body: emptyState("Could not load history", errorMessage(error) || "Try again shortly."),
        }),
      ]);
      return;
    }
  }

  if (!state.historyRows.length) {
    byId("view").innerHTML = pageStack([
      pageIntro("hist"),
      sectionCard({
        title: "Transplant History",
        body: emptyState("No sessions yet", "Saved clinical days will appear here after you save a roster."),
      }),
    ]);
    return;
  }

  const q = historyFilterQuery.trim().toLowerCase();
  const rows = state.historyRows.filter((session) => {
    if (!q) return true;
    return `${session.date} ${session.lead || ""}`.toLowerCase().includes(q);
  });

  const listHtml = rows.length ? rows.map((session) => {
    const keys = Object.keys(session.C || {});
    const archived = session.cfg?.completedCases || [];
    const grafts = keys.reduce((sum, key) => sum + Number(session.C[key]?.procedure?.extraction?.grafts || 0), 0)
      + archived.reduce((sum, entry) => sum + Number(entry.record?.procedure?.extraction?.grafts || 0), 0);
    const done = keys.filter((key) => session.C[key]?.status === "completed").length + archived.length;
    const totalCases = keys.length + archived.length;
    const open = state.historyDetailDate === session.date;
    return `<div class="history-session">
      <button class="card blue click-card history-head" onclick="void dsa.toggleHistoryDetail('${E(session.date)}')">
        <div class="row" style="justify-content:space-between">
          <div><strong>${new Date(`${session.date}T00:00`).toLocaleDateString("en-PK", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong><div class="muted">${totalCases} cases - ${grafts.toLocaleString()} grafts ${session.lead ? `- ${E(session.lead)}` : ""}</div></div>
          <div class="history-head-actions"><span class="pill ${done === totalCases && totalCases ? "done" : done ? "active" : "scheduled"}">${done}/${totalCases} done</span><span class="pill active">${open ? "Hide" : "Details"}</span></div>
        </div>
      </button>
      ${open ? (state.historyLoading ? `<div class="history-detail-panel"><div class="card history-loading">Loading session details...</div></div>` : historyDetail(session)) : ""}
    </div>`;
  }).join("") : emptyState("No matching sessions", "Try a different search term.");

  byId("view").innerHTML = pageStack([
    pageIntro("hist"),
    sectionCard({
      title: "Transplant History",
      subtitle: "Browse saved sessions, expand clinical detail, and reload a day.",
      body: `<div class="filter-bar">
        <input class="inline-input" type="search" placeholder="Search by date or lead..." value="${E(historyFilterQuery)}" oninput="dsa.filterHistory(this.value)">
      </div>
      <div class="history-list">${listHtml}</div>`,
    }),
  ]);
}

function historyDetail(session: LoadedSession): string {
  const checks = session.cfg?.checks || [];
  const roomCount = Number(session.cc || Object.keys(session.C || {}).length || 0);
  const caseRows = Object.entries(session.C || {}).map(([key, record]) => historyCaseRow(key, record, false, session)).join("");
  const archivedRows = (session.cfg?.completedCases || [])
    .map((entry, index) => historyCaseRow(`${entry.roomKey || `archive${index}`}`, entry.record, true, session, entry.roomName, entry.dischargedAt))
    .join("");
  const prRows = Object.entries(session.PR || {}).map(([key, room]) => {
    const queueRows = (room.queue || []).map((item, index) => `<div class="history-subrow"><strong>${index + 1}. ${E(item.patient.name || "Unnamed")}</strong><span>${E(item.procedure || "-")}</span><span>${E(item.patient.contact || "-")}</span><span>${E(item.notes || "-")}</span></div>`).join("");
    return `<details class="history-expand teal-row">
      <summary>
        <span><strong>${E(key.toUpperCase())}</strong><small>${E(room.patient.name || "No patient assigned")} - ${E(room.status)}</small></span>
        <span class="pill ${room.status === "occupied" ? "active" : room.status === "completed" ? "done" : "scheduled"}">${E(room.status)}</span>
      </summary>
      <div class="history-field-grid">
        ${historyField("Patient", room.patient.name)}
        ${historyField("Contact", room.patient.contact)}
        ${historyField("Age", room.patient.age)}
        ${historyField("Gender", room.patient.gender)}
        ${historyField("Blood Group", room.patient.bloodGroup)}
        ${historyField("Allergies", room.patient.allergies)}
        ${historyField("Assignee", room.assignee)}
        ${historyField("Procedure", room.procedure)}
        ${historyField("Notes", room.notes)}
        ${historyField("Queue Count", String(room.queue?.length || 0))}
      </div>
      <div class="section history-inner-section"><h2>Waiting Queue</h2><div class="line"></div></div>
      <div class="history-queue">${queueRows || `<span class="muted">No waiting patients</span>`}</div>
    </details>`;
  }).join("");
  const visibleRoomNames = Array.from({ length: Math.max(roomCount, session.cfg?.rooms?.length || 0) }, (_, index) => {
    const roomNameValue = session.cfg?.rooms?.[index] || `OT Room ${index + 1}`;
    const roomLeadValue = session.cfg?.roomLeads?.[index] || "";
    return `<div class="history-subrow"><strong>OT ${index + 1}</strong><span>${E(roomNameValue)}</span><span>${E(roomLeadValue || "No lead")}</span></div>`;
  }).join("");
  const configRows = `<details class="history-expand config-row">
    <summary><span><strong>Saved Settings & Configuration</strong><small>Staff, rooms, procedures, checklist, and clinic info saved with this session</small></span><span class="pill active">Config</span></summary>
    <div class="history-field-grid">
      ${historyField("Clinic Name", session.cfg?.clinicName)}
      ${historyField("Clinic Phone", session.cfg?.clinicPhone)}
      ${historyField("Clinic Email", session.cfg?.clinicEmail)}
      ${historyField("Session Lead", session.lead)}
      ${historyField("Room Count", String(roomCount))}
      ${historyField("Staff", (session.cfg?.staff || []).join(", "))}
      ${historyField("Procedures", (session.cfg?.procedures || []).join(", "))}
      ${historyField("Checklist", checks.map((check) => check.l).join(", "))}
    </div>
    <div class="section history-inner-section"><h2>Rooms & Leads</h2><div class="line"></div></div>
    <div class="history-queue">${visibleRoomNames || `<span class="muted">No room configuration saved.</span>`}</div>
  </details>`;

  return `<div class="history-detail-panel">
    <div class="history-detail-toolbar">
      <button class="btn primary" onclick="void dsa.openHistorySession('${E(session.date)}')">Load This Session</button>
      <button class="btn ghost" onclick="void dsa.toggleHistoryDetail('${E(session.date)}')">Hide Details</button>
    </div>
    <details class="history-expand summary-row" open>
      <summary><span><strong>Saved Session Summary</strong><small>Everything stored for ${E(session.date)}</small></span><span class="pill active">Open</span></summary>
      <div class="history-field-grid">
        ${historyField("Date", session.date)}
        ${historyField("Lead", session.lead)}
        ${historyField("Room Count", String(roomCount))}
        ${historyField("OT Records", String(Object.keys(session.C || {}).length))}
        ${historyField("Discharged Archives", String(session.cfg?.completedCases?.length || 0))}
        ${historyField("Procedure Rooms", String(Object.keys(session.PR || {}).length))}
      </div>
    </details>
    <div class="section history-inner-section"><h2>Operation Theaters</h2><div class="line"></div></div>
    <div class="history-detail-list">${caseRows || `<div class="empty-panel">No active OT records.</div>`}</div>
    <div class="section history-inner-section"><h2>Discharged Archive</h2><div class="line"></div></div>
    <div class="history-detail-list">${archivedRows || `<div class="empty-panel">No discharged archives.</div>`}</div>
    <div class="section history-inner-section"><h2>Procedure Rooms & Queues</h2><div class="line"></div></div>
    <div class="history-detail-list">${prRows || `<div class="empty-panel">No procedure room records.</div>`}</div>
    <div class="section history-inner-section"><h2>Saved App Settings</h2><div class="line"></div></div>
    <div class="history-detail-list">${configRows}</div>
  </div>`;
}

function historyField(label: string, value: unknown): string {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return `<div class="history-field"><span>${E(label)}</span><strong>${E(text)}</strong></div>`;
}

function historyCaseRow(key: string, record: CaseRecord, archived: boolean, session: LoadedSession, archivedRoomName?: string, dischargedAt?: string): string {
  const roomLabel = archivedRoomName || key.toUpperCase();
  const extracted = Number(record.procedure.extraction.grafts || 0);
  const placed = placedTotal(record);
  const checks = session.cfg?.checks || [];
  const preOps = checks.length ? checks.filter((check) => Boolean(record.preOp?.[check.k])).length : Object.values(record.preOp || {}).filter(Boolean).length;
  const teamRows = Object.entries(record.teams || {}).map(([teamKey, rows]) => {
    const assignments = Object.entries(rows || {}).map(([rowKey, members]) => `${rowKey}: ${(members || []).join(", ") || "-"}`).join(" | ");
    return `<div class="history-subrow"><strong>${E(teamKey)}</strong><span>${E(assignments || "-")}</span></div>`;
  }).join("");
  const checkRows = checks.map((check) => `<div class="history-subrow"><strong>${E(check.l)}</strong><span>${record.preOp?.[check.k] ? "Done" : "Pending"}</span><span>${E(check.s || "")}</span></div>`).join("");
  return `<details class="history-expand ${archived ? "archived" : ""}">
    <summary>
      <span><strong>${E(roomLabel)}${archived ? " - Discharged" : ""}</strong><small>${E(record.patient.name || "No patient")} - ${E(record.assessment.procedureType || "-")}</small></span>
      <span class="pill ${record.status === "completed" || archived ? "done" : phaseIndex(record.procedure.currentPhase) > 0 ? "active" : "scheduled"}">${archived ? "Discharged" : E(record.status)}</span>
    </summary>
    <div class="history-field-grid">
      ${historyField("Patient", record.patient.name)}
      ${historyField("Age", record.patient.age)}
      ${historyField("Gender", record.patient.gender)}
      ${historyField("Contact", record.patient.contact)}
      ${historyField("Blood Group", record.patient.bloodGroup)}
      ${historyField("Allergies", record.patient.allergies)}
      ${historyField("Medications", record.patient.medications)}
      ${historyField("Procedure Type", record.assessment.procedureType)}
      ${historyField("Baldness Type", record.assessment.norwoodScale)}
      ${historyField("Donor Density", record.assessment.donorDensity)}
      ${historyField("Recipient Area", record.assessment.recipientArea)}
      ${historyField("Graft Estimate", record.assessment.graftEstimate)}
      ${historyField("Notes", record.assessment.notes)}
      ${historyField("Current Phase", PHL[record.procedure.currentPhase] || record.procedure.currentPhase)}
      ${historyField("Status", archived ? "discharged" : record.status)}
      ${historyField("Start Time", record.startTime)}
      ${historyField("End Time", record.endTime)}
      ${historyField("Extracted Grafts", extracted.toLocaleString())}
      ${historyField("Placed Total", placed.toLocaleString())}
      ${historyField("Hairline Placed", record.procedure.placing.hairline)}
      ${historyField("Middle Placed", record.procedure.placing.middle)}
      ${historyField("Crown Placed", record.procedure.placing.crown)}
      ${historyField("Anaesthesia", `${record.procedure.anaesthesia.start || "--:--"} -> ${record.procedure.anaesthesia.end || "--:--"}`)}
      ${historyField("Extraction", `${record.procedure.extraction.start || "--:--"} -> ${record.procedure.extraction.end || "--:--"}`)}
      ${historyField("Placing", `${record.procedure.placing.start || "--:--"} -> ${record.procedure.placing.end || "--:--"}`)}
      ${historyField("Dressing", `${record.procedure.dressing.start || "--:--"} -> ${record.procedure.dressing.end || "--:--"}`)}
      ${historyField("Pre-op Complete", `${preOps}/${checks.length || 0}`)}
      ${historyField("Prescriptions", record.postOp.prescriptions)}
      ${historyField("Follow Up", record.postOp.followUpDate)}
      ${historyField("Discharge Time", dischargedAt || record.postOp.dischargeTime)}
    </div>
    <div class="section history-inner-section"><h2>Pre-Op Checklist</h2><div class="line"></div></div>
    <div class="history-queue">${checkRows || `<span class="muted">No checklist saved.</span>`}</div>
    <div class="section history-inner-section"><h2>Team Assignments</h2><div class="line"></div></div>
    <div class="history-queue">${teamRows || `<span class="muted">No team assignments saved.</span>`}</div>
  </details>`;
}

function setNestedValue(target: MutableRecord, path: string, value: string): void {
  const parts = path.split(".");
  let obj = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!obj[key] || typeof obj[key] !== "object") obj[key] = {};
    obj = obj[key] as MutableRecord;
  }
  obj[parts[parts.length - 1]] = value;
}

function normalizeFieldValue(path: string, value: string): string {
  if (path.endsWith(".age") || path.endsWith("graftEstimate")) return normalizeNumberString(value);
  return value.trim();
}

function currentTarget(): MutableRecord {
  return state.selectedCase.startsWith("pr")
    ? (selectedProcedureRoom() as unknown as MutableRecord)
    : (selectedCase() as unknown as MutableRecord);
}

function currentTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function ensureRoomNames(count: number): void {
  for (let i = 0; i < count; i += 1) {
    if (!state.cfg.rooms[i]) state.cfg.rooms[i] = `OT Room ${i + 1}`;
  }
  if (!Array.isArray(state.cfg.roomLeads)) state.cfg.roomLeads = [];
  if (!Array.isArray(state.cfg.completedCases)) state.cfg.completedCases = [];
  Object.values(state.PR).forEach((room) => {
    if (!Array.isArray(room.queue)) room.queue = [];
  });
}

function freshCase(): CaseRecord {
  const nextCase = defaultCase(state.cfg);
  state.cfg.checks.forEach((check) => {
    nextCase.preOp[check.k] = false;
  });
  return nextCase;
}

function archiveAndClearCase(caseKey: string, record: CaseRecord): void {
  if (!Array.isArray(state.cfg.completedCases)) state.cfg.completedCases = [];
  const roomIndex = Number(caseKey.replace("case", "")) || 1;
  const archivedRecord = JSON.parse(JSON.stringify(record)) as CaseRecord;
  archivedRecord.status = "completed";
  state.cfg.completedCases.push({
    roomKey: caseKey,
    roomName: roomName(roomIndex),
    dischargedAt: archivedRecord.postOp.dischargeTime || currentTimeValue(),
    record: archivedRecord,
  });
  state.C[caseKey] = freshCase();
}

function roomHasData(index: number): boolean {
  const record = state.C[`case${index}`];
  if (!record) return false;
  const patientValues = Object.values(record.patient).some(Boolean);
  const assessmentValues = Object.entries(record.assessment).some(([key, value]) => key !== "procedureType" && Boolean(value));
  const preOpValues = Object.values(record.preOp).some(Boolean);
  const procedureTimes = (["anaesthesia", "extraction", "placing", "dressing"] as LivePhase[])
    .some((phase) => Boolean(record.procedure[phase].start || record.procedure[phase].end));

  return patientValues
    || assessmentValues
    || preOpValues
    || procedureTimes
    || phaseIndex(record.procedure.currentPhase) > 0
    || record.status !== "scheduled"
    || Number(record.procedure.extraction.grafts || 0) > 0
    || placedTotal(record) > 0
    || Boolean(record.startTime || record.endTime || record.postOp.prescriptions || record.postOp.followUpDate || record.postOp.dischargeTime);
}

function doAdvance(key: string, phase: Phase): void {
  const record = state.C[key];
  if (!record) return;
  if (phaseIndex(phase) > phaseIndex(record.procedure.currentPhase)) record.procedure.currentPhase = phase;
  if (phaseIndex(phase) > 0 && record.status !== "completed") record.status = "in-progress";
  scheduleSave(true);
  updateLiveBadge();
  render();
}

const actions: DsaActions = {
  go(tab) {
    state.currentTab = tab;
    render();
  },
  saveNow,
  async changeRoomCount(value) {
    const nextCount = Math.min(99, Math.max(1, Number(value) || 1));
    if (nextCount === state.cc) return;

    if (nextCount < state.cc) {
      const hiddenRoomsHaveData = Array.from({ length: state.cc - nextCount }, (_, index) => nextCount + index + 1).some(roomHasData);
      if (hiddenRoomsHaveData && !(await confirmAction("Some rooms you are hiding already have patient/procedure data. Hide them anyway? Data will stay if you add the rooms back.", "Hide rooms?"))) {
        render();
        return;
      }
    }

    state.cc = nextCount;
    ensureRoomNames(state.cc);
    ensureCases();
    scheduleSave(true);
    render();
  },
  addRoom() {
    state.roomModalOpen = true;
    render();
  },
  closeRoomModal() {
    state.roomModalOpen = false;
    render();
  },
  submitRoomModal() {
    const roomNumber = Math.floor(Number(inputValue("roomNumberInput")) || 0);
    const name = inputValue("roomNameInput") || `OT Room ${roomNumber}`;
    const lead = inputValue("roomLeadInput");

    if (roomNumber < 1 || roomNumber > 99) {
      setSaveError("Room number must be between 1 and 99.");
      return;
    }

    state.cc = Math.max(state.cc, roomNumber);
    ensureRoomNames(state.cc);
    state.cfg.rooms[roomNumber - 1] = name;
    state.cfg.roomLeads[roomNumber - 1] = lead;
    ensureCases();
    state.selectedCase = `case${roomNumber}`;
    state.dashboardDetail = "rooms";
    state.roomModalOpen = false;
    scheduleSave(true);
    render();
    toast(`${name} added.`, "success");
  },
  async removeRoom() {
    if (state.cc <= 1) {
      setSaveError("At least one room is required.");
      return;
    }
    if (roomHasData(state.cc) && !(await confirmAction(`${roomName(state.cc)} has patient/procedure data. Hide this room anyway? Data will stay if you add the room back.`, "Hide room?"))) {
      return;
    }
    const removedRoomName = roomName(state.cc);
    state.cc -= 1;
    if (state.selectedCase === `case${state.cc + 1}`) state.selectedCase = `case${state.cc}`;
    ensureCases();
    scheduleSave(true);
    render();
    toast(`${removedRoomName} hidden.`, "success");
  },
  async changeDate(value) {
    if (hasPendingSave()) {
      const saved = await flushSave();
      if (!saved && !(await confirmAction("Could not save current changes. Change date and discard them?", "Unsaved changes"))) {
        render();
        return;
      }
      clearSaveTimer();
    }
    state.sessionDate = value || today();
    await loadSession();
    render();
  },
  changeLead(value) {
    state.leadName = value.trim();
    scheduleSave(true);
    if (state.currentTab === "dash") renderDashboard();
  },
  showDashboardDetail(detail) {
    state.dashboardDetail = state.dashboardDetail === detail ? "hidden" : detail;
    renderDashboard();
  },
  pickCase(key) {
    state.selectedCase = key;
    if (!key.startsWith("pr")) state.selectedRosterTab = "patient";
    renderRoster();
  },
  pickRosterTab(tab) {
    state.selectedRosterTab = tab;
    renderRoster();
  },
  setField(path, value) {
    setNestedValue(currentTarget(), path, normalizeFieldValue(path, value));
    scheduleSave(true);
  },
  setCaseField(caseKey, path, value) {
    const record = state.C[caseKey];
    if (!record) {
      setSaveError(`Missing case ${caseKey}`);
      return;
    }
    setNestedValue(record as unknown as MutableRecord, path, normalizeFieldValue(path, value));
    scheduleSave(true);
    if (state.currentTab === "live") renderLive();
  },
  togglePreOp(key) {
    const record = selectedCase();
    record.preOp[key] = !record.preOp[key];
    scheduleSave(true);
    renderRoster();
  },
  advance(key, phase) {
    doAdvance(key, phase);
  },
  startPhase(caseKey, phase) {
    const record = state.C[caseKey];
    if (!record) {
      setSaveError(`Missing case ${caseKey}`);
      return;
    }
    record.procedure[phase].start = currentTimeValue();
    record.procedure[phase].end = "";
    record.procedure.currentPhase = phase;
    record.status = "in-progress";
    scheduleSave(true);
    updateLiveBadge();
    renderLive();
    toast(`${PHL[phase]} started.`);
  },
  endPhase(caseKey, phase, next) {
    const record = state.C[caseKey];
    if (!record) {
      setSaveError(`Missing case ${caseKey}`);
      return;
    }
    const now = currentTimeValue();
    if (!record.procedure[phase].start) record.procedure[phase].start = now;
    record.procedure[phase].end = now;
    record.procedure.currentPhase = next;
    if (record.status !== "completed") record.status = "in-progress";
    scheduleSave(true);
    updateLiveBadge();
    renderLive();
    toast(`${PHL[phase]} ended.`);
  },
  addMember(teamKey, rowKey, name) {
    if (!name) return;
    const record = selectedCase();
    const list = record.teams[teamKey]?.[rowKey];
    if (list && !list.includes(name)) list.push(name);
    scheduleSave(true);
    renderRoster();
  },
  async removeMember(teamKey, rowKey, index) {
    if (!(await confirmAction("Remove this team member from the assignment?", "Remove member"))) return;
    const list = selectedCase().teams[teamKey]?.[rowKey];
    if (list) list.splice(index, 1);
    scheduleSave(true);
    renderRoster();
  },
  addMemberForCase(caseKey, teamKey, rowKey, name) {
    if (!name) return;
    const record = state.C[caseKey];
    const list = record?.teams[teamKey]?.[rowKey];
    if (list && !list.includes(name)) list.push(name);
    scheduleSave(true);
    renderLive();
  },
  async removeMemberForCase(caseKey, teamKey, rowKey, index) {
    if (!(await confirmAction("Remove this team member from the assignment?", "Remove member"))) return;
    const list = state.C[caseKey]?.teams[teamKey]?.[rowKey];
    if (list) list.splice(index, 1);
    scheduleSave(true);
    renderLive();
  },
  adj(key, group, field, delta) {
    const record = state.C[key];
    const groupValue = record.procedure[group] as unknown as Record<string, number>;
    groupValue[field] = Math.max(0, Number(groupValue[field] || 0) + delta);
    scheduleSave(true);
    renderLive();
  },
  openRosterItem(key, tab) {
    state.currentTab = "roster";
    state.selectedCase = key;
    if (!key.startsWith("pr")) state.selectedRosterTab = tab || "patient";
    render();
  },
  setProcedureRoomField(roomKey, path, value) {
    const room = state.PR[roomKey];
    if (!room) return;
    setNestedValue(room as unknown as MutableRecord, path, value);
    scheduleSave(true);
    if (state.currentTab === "live") renderLive();
    else renderProcedureRoom();
  },
  addProcedureQueuePatient(roomKey) {
    const room = state.PR[roomKey];
    if (!room) return;
    const name = inputValue(`${roomKey}QueueName`);
    const contact = inputValue(`${roomKey}QueueContact`);
    const procedure = inputValue(`${roomKey}QueueProcedure`);
    const notes = inputValue(`${roomKey}QueueNotes`);
    if (!name) {
      setSaveError("Patient name is required for the waiting queue.");
      return;
    }
    if (!Array.isArray(room.queue)) room.queue = [];
    const queueItem: ProcedureQueueItem = {
      patient: { name, contact, age: "", gender: "", bloodGroup: "", allergies: "" },
      procedure,
      notes,
      addedAt: new Date().toISOString(),
    };
    room.queue.push(queueItem);
    scheduleSave(true);
    renderProcedureRoom();
    toast("Patient added to waiting queue.");
  },
  async removeProcedureQueuePatient(roomKey, index) {
    const room = state.PR[roomKey];
    if (!room?.queue?.[index]) return;
    if (!(await confirmAction("Remove this patient from the waiting queue?", "Remove from queue"))) return;
    room.queue.splice(index, 1);
    scheduleSave(true);
    renderProcedureRoom();
  },
  async moveQueuePatientToRoom(roomKey, index) {
    const room = state.PR[roomKey];
    const queueItem = room?.queue?.[index];
    if (!room || !queueItem) return;
    if (room.patient.name && !(await confirmAction("This procedure room already has a patient. Replace with the queued patient?", "Replace patient?"))) return;
    room.patient = { ...queueItem.patient };
    room.procedure = queueItem.procedure;
    room.notes = queueItem.notes;
    room.status = "occupied";
    room.queue.splice(index, 1);
    scheduleSave(true);
    renderProcedureRoom();
    toast("Queued patient moved to procedure room.", "success");
  },
  pickSettingsTab(tab) {
    state.cfgTab = tab;
    renderSettings();
  },
  addCfg(type, inputId) {
    const value = inputValue(inputId);
    if (!value) {
      setSaveError("Enter a value before adding it.");
      return;
    }
    if (state.cfg[type].some((item) => item.toLowerCase() === value.toLowerCase())) {
      setSaveError("That item already exists.");
      return;
    }
    state.cfg[type].push(value);
    scheduleSave(true);
    renderSettings();
  },
  async removeCfg(type, index) {
    if (!(await confirmAction("Remove this item from settings? Existing sessions may still reference it.", "Remove item"))) return;
    state.cfg[type].splice(index, 1);
    scheduleSave(true);
    renderSettings();
  },
  async resetCfg(type) {
    if (!(await confirmAction("Reset this settings section to defaults?", "Reset section"))) return;
    if (type === "staff") state.cfg.staff = [...DEF_STAFF];
    if (type === "rooms") {
      state.cfg.rooms = [...DEF_ROOMS];
      state.cfg.roomLeads = [];
      state.cfg.procRooms = ["Procedure Room 1", "Procedure Room 2"];
    }
    if (type === "procedures") state.cfg.procedures = [...DEF_PROCS];
    if (type === "checks") state.cfg.checks = DEF_CHECKS.map((check) => ({ ...check }));
    scheduleSave(true);
    renderSettings();
    toast("Settings section reset to defaults.", "success");
  },
  addCheck() {
    const label = inputValue("newCheckLabel");
    const description = inputValue("newCheckDesc");
    if (!label) {
      setSaveError("Checklist label is required.");
      return;
    }
    if (state.cfg.checks.some((check) => check.l.toLowerCase() === label.toLowerCase())) {
      setSaveError("That checklist item already exists.");
      return;
    }
    state.cfg.checks.push({ k: `chk_${Date.now()}`, l: label, s: description });
    scheduleSave(true);
    renderSettings();
  },
  setConfigArrayValue(type, index, value) {
    const nextValue = value.trim();
    if (!nextValue) {
      setSaveError("Room names cannot be empty.");
      renderSettings();
      return;
    }
    state.cfg[type][index] = nextValue;
    scheduleSave(true);
  },
  setRoomLead(index, value) {
    if (!Array.isArray(state.cfg.roomLeads)) state.cfg.roomLeads = [];
    state.cfg.roomLeads[index] = value.trim();
    scheduleSave(true);
  },
  setClinicField(field, value) {
    state.cfg[field] = value.trim();
    scheduleSave(true);
  },
  async dischargeSelectedCase() {
    if (!(await confirmAction("Mark this patient as discharged?", "Discharge patient"))) return;
    const record = selectedCase();
    if (!record.patient.name) {
      setSaveError("No patient is assigned to this OT room.");
      return;
    }
    record.status = "completed";
    record.procedure.currentPhase = "postOp";
    if (!record.postOp.dischargeTime) record.postOp.dischargeTime = currentTimeValue();
    archiveAndClearCase(state.selectedCase, record);
    state.selectedRosterTab = "patient";
    scheduleSave(true);
    updateLiveBadge();
    renderRoster();
    toast("Patient discharged. OT room is now empty.", "success");
  },
  async openHistorySession(date) {
    state.sessionDate = date;
    await loadSession();
    state.currentTab = "dash";
    render();
    toast("Session loaded");
  },
  async toggleHistoryDetail(date) {
    if (state.historyDetailDate === date) {
      state.historyDetailDate = "";
      await renderHistory();
      return;
    }

    state.historyDetailDate = date;
    const index = state.historyRows.findIndex((session) => session.date === date);
    const session = index >= 0 ? state.historyRows[index] : undefined;
    const alreadyFull = Boolean(session?.full);

    if (!alreadyFull) {
      state.historyLoading = true;
      await renderHistory();
      try {
        const data = await apiRequest<{ session?: LoadedSession }>(`/history?date=${encodeURIComponent(date)}`);
        if (data.session) {
          const fullSession: LoadedSession = { ...data.session, full: true };
          if (index >= 0) state.historyRows[index] = fullSession;
          else state.historyRows.unshift(fullSession);
        }
      } catch (error) {
        toast(errorMessage(error) || "Could not load session details");
      } finally {
        state.historyLoading = false;
      }
    }

    await renderHistory();
  },
  toggleLiveCard(key) {
    const defaultOpen = (() => {
      if (key.startsWith("pr")) return state.PR[key]?.status === "occupied";
      const record = state.C[key];
      return record ? liveCaseStatus(record)[0] === "active" : false;
    })();
    const openNow = Object.prototype.hasOwnProperty.call(state.liveOpenCases, key)
      ? state.liveOpenCases[key]
      : defaultOpen;
    state.liveOpenCases[key] = !openNow;
    renderLive();
  },
  filterHistory(query) {
    historyFilterQuery = query;
    void renderHistory();
  },
  filterDashboard(query) {
    dashboardFilterQuery = query;
    if (state.currentTab === "dash") renderDashboard();
  },
  async login() {
    byId("logErr").textContent = "";
    const loginBtn = byId<HTMLButtonElement>("loginBtn");
    loginBtn.disabled = true;
    loginBtn.classList.add("loading");
    loginBtn.textContent = "Signing in...";
    try {
      const email = inputValue("logEmail").toLowerCase();
      const user = await signIn(email, byId<HTMLInputElement>("logPass").value);
      persistRememberedEmail(email);
      await showAuthOverlay("Welcome back", "Login successful — opening your workspace…", 900);
      await startApp(user);
    } catch (error) {
      byId("logErr").textContent = errorMessage(error);
    } finally {
      loginBtn.disabled = false;
      loginBtn.classList.remove("loading");
      loginBtn.textContent = "Sign In";
    }
  },
  async logout() {
    if (hasPendingSave()) {
      const saved = await flushSave();
      if (!saved && !(await confirmAction("Could not save current changes. Sign out and discard them?", "Sign out"))) {
        return;
      }
      clearSaveTimer();
    }
    const confirmed = await confirmAction("Sign out of MSK Duty Roster?", "Sign out");
    if (!confirmed) return;
    try {
      await signOut();
      await showAuthOverlay("Signed out", "See you next session.", 800);
    } finally {
      state.curUser = null;
      byId("mainApp").classList.remove("on", "sidebar-open");
      byId<HTMLElement>("loginScreen").style.display = "flex";
      byId<HTMLInputElement>("logPass").value = "";
      renderSessionBar();
      updateStickySave();
    }
  },
};

async function startApp(user: User): Promise<void> {
  state.curUser = user;
  byId("usrName").textContent = user.user_metadata?.full_name || user.email || "User";
  byId<HTMLElement>("loginScreen").style.display = "none";
  byId("mainApp").classList.add("on");
  await loadSession();
  render();
  renderSessionBar();
  updateStickySave();
}

function bindStaticEvents(): void {
  window.dsa = actions;
  injectShellIcons();
  initMskControls();
  applyRememberedEmail();
  byId("loginBtn").addEventListener("click", () => void actions.login());
  byId("logoutBtn").addEventListener("click", () => void actions.logout());
  byId<HTMLInputElement>("logPass").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void actions.login();
  });
  byId("togglePass").addEventListener("click", () => {
    const passwordInput = byId<HTMLInputElement>("logPass");
    const toggleButton = byId<HTMLButtonElement>("togglePass");
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    toggleButton.classList.toggle("show", !showing);
    toggleButton.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    toggleButton.title = showing ? "Show password" : "Hide password";
  });
  byId("menuToggle").addEventListener("click", () => toggleMobileSidebar());
  byId("sidebarBackdrop").addEventListener("click", () => closeMobileSidebar());
  window.addEventListener("resize", syncMobileNavMode);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileSidebar();
  });
  byId("sidebarCollapseBtn").addEventListener("click", () => toggleSidebarCollapse());
  byId("stickySaveBtn").addEventListener("click", () => void actions.saveNow(true));
  byId("tabs").addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
    if (tab?.dataset.tab) {
      closeMobileSidebar();
      actions.go(tab.dataset.tab as AppTab);
    }
  });
}

export async function initApp(): Promise<void> {
  bindStaticEvents();
  tick();
  window.setInterval(tick, 1000);
  const user = await getSessionUser();
  if (user) await startApp(user);
}
