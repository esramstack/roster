/** View router. Renders the shell and the active view, preserving focus across re-renders. */
import { adoptNewRecords } from "./core/sync";
import { ensureCases, state } from "./state";
import type { AppTab } from "./types";
import { isEditing, maybeId } from "./ui/dom";
import { isDialogOpen } from "./ui/overlay";
import { paintTimers } from "./ui/ticker";
import { renderHistory } from "./views/history";
import { renderLive } from "./views/live";
import { renderOverview } from "./views/overview";
import { renderProcedureRooms } from "./views/procedureRooms";
import { renderRoster, renderRosterChrome } from "./views/roster";
import { renderSettings } from "./views/settings";
import { renderNav, renderShell, renderSyncPill } from "./views/shell";

const VIEWS: Record<AppTab, () => string> = {
  dash: renderOverview,
  roster: renderRoster,
  live: renderLive,
  rooms: renderProcedureRooms,
  hist: renderHistory,
  settings: renderSettings,
};

let lastTab: AppTab | null = null;
let pendingRefresh = false;

interface FocusSnapshot {
  id: string;
  start: number | null;
  end: number | null;
}

function captureFocus(): FocusSnapshot | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !el.id || el === document.body) return null;
  const input = el as HTMLInputElement;
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = input.selectionStart ?? null;
    end = input.selectionEnd ?? null;
  } catch {
    /* not a text input */
  }
  return { id: el.id, start, end };
}

function restoreFocus(snap: FocusSnapshot | null): void {
  if (!snap) return;
  const el = document.getElementById(snap.id) as HTMLInputElement | null;
  if (!el || el.hasAttribute("disabled")) return;
  el.focus({ preventScroll: true });
  if (snap.start !== null) {
    try {
      el.setSelectionRange(snap.start, snap.end ?? snap.start);
    } catch {
      /* ignore */
    }
  }
}

export function render(): void {
  if (!state.curUser) return;
  ensureCases();
  adoptNewRecords();
  pendingRefresh = false;
  const focus = captureFocus();
  renderShell();
  const view = maybeId("view");
  if (!view) return;
  const tabChanged = lastTab !== state.currentTab;
  view.innerHTML = VIEWS[state.currentTab]();
  view.dataset.view = state.currentTab;
  if (tabChanged) {
    window.scrollTo({ top: 0 });
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
    lastTab = state.currentTab;
    maybeId("view")?.focus({ preventScroll: true });
  } else {
    restoreFocus(focus);
  }
  paintTimers();
}

/** Re-render after the current event settles, so focus has moved to the next field first. */
export function renderSoon(): void {
  window.setTimeout(render, 0);
}

/** Refresh derived chrome only (nav badges, roster header) without touching the form being edited. */
export function renderChrome(): void {
  if (!state.curUser || state.loading) {
    renderSyncPill();
    return;
  }
  renderNav();
  renderSyncPill();
  if (state.currentTab === "roster") renderRosterChrome();
  paintTimers();
}

/** Background refresh (remote changes, time-based alerts): never interrupts typing or dialogs. */
export function softRefresh(): void {
  if (!state.curUser) return;
  if (isEditing() || isDialogOpen()) {
    pendingRefresh = true;
    renderChrome();
    return;
  }
  render();
}

export function flushPendingRefresh(): void {
  if (pendingRefresh && !isEditing() && !isDialogOpen()) render();
}
