/** Sidebar badges, top bar and sync indicator. */
import { hasLocalChanges } from "../core/sync";
import { allCaseViews, floorAlerts } from "../core/derive";
import { procRoomKeys, state, today } from "../state";
import type { AppTab } from "../types";
import { avatar } from "../ui/components";
import { E, fmtDateShort, maybeId } from "../ui/dom";
import { icon } from "../ui/icons";
import { fmtTime } from "../core/time";

export const NAV: Array<{ tab: AppTab; label: string; icon: string; group: "ops" | "sys" }> = [
  { tab: "dash", label: "Overview", icon: "overview", group: "ops" },
  { tab: "roster", label: "Today's Roster", icon: "roster", group: "ops" },
  { tab: "live", label: "Live Floor", icon: "live", group: "ops" },
  { tab: "rooms", label: "Procedure Rooms", icon: "rooms", group: "ops" },
  { tab: "hist", label: "History", icon: "hist", group: "sys" },
  { tab: "settings", label: "Settings", icon: "settings", group: "sys" },
];

export const TITLES: Record<AppTab, string> = {
  dash: "Overview",
  roster: "Today's Roster",
  live: "Live Floor",
  rooms: "Procedure Rooms",
  hist: "History",
  settings: "Settings",
};

function navCount(tab: AppTab): string {
  if (tab === "live") {
    const live = allCaseViews().filter((v) => v.active).length;
    return live ? `<span class="nav-count is-live" aria-label="${live} live">${live}</span>` : "";
  }
  if (tab === "dash") {
    const n = floorAlerts().filter((a) => a.level !== "info").length;
    return n ? `<span class="nav-count is-attention" aria-label="${n} need attention">${n}</span>` : "";
  }
  if (tab === "rooms") {
    const q = procRoomKeys().reduce((sum, key) => sum + (state.PR[key]?.queue?.length || 0), 0);
    return q ? `<span class="nav-count" aria-label="${q} waiting">${q}</span>` : "";
  }
  return "";
}

export function renderNav(): void {
  const host = maybeId("nav");
  if (!host) return;
  const item = (n: (typeof NAV)[number]) => `<button type="button" class="nav-item${state.currentTab === n.tab ? " on" : ""}" data-tab="${n.tab}" ${state.currentTab === n.tab ? 'aria-current="page"' : ""} title="${E(n.label)}">
      ${icon(n.icon)}<span class="nav-label">${E(n.label)}</span>${navCount(n.tab)}
    </button>`;
  host.innerHTML = `<div class="nav-group">Operations</div>${NAV.filter((n) => n.group === "ops").map(item).join("")}
    <div class="nav-group">Records</div>${NAV.filter((n) => n.group === "sys").map(item).join("")}`;
}

export function syncPill(): string {
  const s = state.saveStatus;
  const map: Record<typeof s, { tone: string; ico: string; label: string; title: string }> = {
    idle: { tone: "ok", ico: "cloud", label: "Synced", title: "Everything is up to date" },
    saved: { tone: "ok", ico: "check", label: state.lastSavedAt ? `Saved ${fmtTime(state.lastSavedAt)}` : "Saved", title: "All changes saved" },
    dirty: { tone: "pending", ico: "dot", label: "Unsaved", title: "Changes will save in a moment. Click to save now." },
    saving: { tone: "pending", ico: "refresh", label: "Saving…", title: "Saving changes" },
    error: { tone: "error", ico: "alert", label: "Save failed", title: `${state.saveError || "Save failed"}. Click to retry.` },
    offline: { tone: "offline", ico: "cloudOff", label: "Offline", title: "Changes are kept on this device and will sync when the connection returns. Click to retry." },
  };
  const m = map[s];
  const label = s === "offline" && hasLocalChanges() ? "Offline · pending" : m.label;
  return `<button type="button" class="sync-pill sync-${m.tone}${s === "saving" ? " is-busy" : ""}" onclick="void dsa.saveNow(true)" title="${E(m.title)}" aria-live="polite">${icon(m.ico)}<span>${E(label)}</span></button>`;
}

export function renderSyncPill(): void {
  const host = maybeId("syncHost");
  if (host) host.innerHTML = syncPill();
}

export function renderTopbar(): void {
  const host = maybeId("topbarMain");
  if (!host || !state.curUser) return;
  const isToday = state.sessionDate === today();
  const user = state.curUser.user_metadata?.full_name || state.curUser.email || "User";
  host.innerHTML = `
    <div class="tb-title">
      <h1>${E(TITLES[state.currentTab])}</h1>
      <span class="tb-clinic">${E(state.cfg.clinicName || "MSK Aesthetics")}</span>
    </div>
    <div class="tb-session">
      <label class="tb-field ${isToday ? "" : "is-past"}" title="Session date">
        ${icon("calendar")}
        <span class="sr-only">Session date</span>
        <input type="date" value="${E(state.sessionDate)}" onchange="void dsa.changeDate(this.value)" aria-label="Session date">
        <span class="tb-date-label" aria-hidden="true">${isToday ? "Today" : E(fmtDateShort(state.sessionDate))}</span>
      </label>
      ${isToday ? "" : `<button type="button" class="btn ghost xs" onclick="void dsa.changeDate('${today()}')">Go to today</button>`}
      <label class="tb-field lead" title="Session lead">
        <span class="tb-field-k">Lead</span>
        <input list="staffList" value="${E(state.leadName)}" placeholder="Assign lead" onchange="dsa.changeLead(this.value)" aria-label="Session lead">
      </label>
    </div>
    <div class="tb-tools">
      <button type="button" class="tb-search" onclick="dsa.openSearch()" aria-label="Search patients and rooms" title="Search (/)">
        ${icon("search")}<span>Search</span><kbd>/</kbd>
      </button>
      <span id="syncHost">${syncPill()}</span>
      <span class="tb-user" title="${E(state.curUser.email || user)}">${avatar(user, "md")}<span class="tb-user-name">${E(user)}</span></span>
    </div>
    <datalist id="staffList">${state.cfg.staff.map((s) => `<option value="${E(s)}">`).join("")}</datalist>`;
}

export function renderShell(): void {
  renderNav();
  renderTopbar();
}
