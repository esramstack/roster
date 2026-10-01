/**
 * Loading, saving and multi-device sync for the daily session.
 *
 * - Saves send only the OT cases / procedure rooms that changed since the last
 *   sync (plus session meta and config, which the Edge Function requires), so a
 *   tablet can't overwrite another tablet's timers with a stale copy.
 * - Unsaved edits are journalled to localStorage and replayed after a refresh,
 *   crash or loss of connection.
 * - The server is polled while the app is open; records not edited locally are
 *   refreshed from the server.
 */
import { apiRequest, AuthError, NetworkError } from "../api";
import { ensureCases, normalizeCase, normalizeConfig, normalizeProcedureRoom, state } from "../state";
import type { CaseRecord, LoadedSession, ProcedureRoom } from "../types";
import { errorMessage } from "../ui/dom";

const JOURNAL_KEY = "msk_ops_journal_v1";
const JOURNAL_MAX_AGE = 36 * 3_600_000;
const DEBOUNCE_MS = 800;
const POLL_MS = 15_000;
const RETRY_STEPS = [2_000, 5_000, 10_000, 30_000];

interface Hooks {
  /** Server data changed the view (poll or merge). */
  onRemoteChange: () => void;
  /** Save status changed. */
  onStatus: () => void;
  toast: (message: string, kind?: "info" | "success" | "error") => void;
  onAuthLost: () => void;
}

let hooks: Hooks = { onRemoteChange: () => {}, onStatus: () => {}, toast: () => {}, onAuthLost: () => {} };
export function setSyncHooks(next: Hooks): void {
  hooks = next;
}

/** Last JSON known to be on the server, per record. */
const synced = new Map<string, string>();
let saveTimer: number | null = null;
let retryTimer: number | null = null;
let retryIndex = 0;
let pollTimer: number | null = null;
let loadToken = 0;

const json = (v: unknown) => JSON.stringify(v ?? null);
const metaJson = () => json({ lead: state.leadName, cc: state.cc });

function currentJson(key: string): string {
  if (key === "cfg") return json(state.cfg);
  if (key === "meta") return metaJson();
  if (key.startsWith("C:")) return json(state.C[key.slice(2)]);
  if (key.startsWith("PR:")) return json(state.PR[key.slice(3)]);
  return "";
}

function allKeys(): string[] {
  return ["cfg", "meta", ...Object.keys(state.C).map((k) => `C:${k}`), ...Object.keys(state.PR).map((k) => `PR:${k}`)];
}

function markAllSynced(): void {
  synced.clear();
  for (const key of allKeys()) synced.set(key, currentJson(key));
}

/**
 * Register records created locally as empty defaults (e.g. a room just added)
 * as clean, so an untouched default never overwrites another device's data.
 * Call right after `ensureCases()`, before any edit to the new record.
 */
export function adoptNewRecords(): void {
  for (const key of allKeys()) if (!synced.has(key)) synced.set(key, currentJson(key));
}

export function dirtyKeys(): string[] {
  return allKeys().filter((key) => synced.get(key) !== currentJson(key));
}

export function hasLocalChanges(): boolean {
  return dirtyKeys().length > 0;
}

function setStatus(status: typeof state.saveStatus, error = ""): void {
  state.saveStatus = status;
  state.saveError = error;
  hooks.onStatus();
}

// ── Journal ──────────────────────────────────────────────────

interface Journal {
  date: string;
  user: string;
  at: number;
  C: Record<string, CaseRecord>;
  PR: Record<string, ProcedureRoom>;
  cfg?: unknown;
  meta?: { lead: string; cc: number };
}

function writeJournal(): void {
  try {
    const dirty = dirtyKeys();
    if (!dirty.length || !state.curUser) {
      localStorage.removeItem(JOURNAL_KEY);
      return;
    }
    const j: Journal = { date: state.sessionDate, user: state.curUser.id, at: Date.now(), C: {}, PR: {} };
    for (const key of dirty) {
      if (key === "cfg") j.cfg = state.cfg;
      else if (key === "meta") j.meta = { lead: state.leadName, cc: state.cc };
      else if (key.startsWith("C:")) j.C[key.slice(2)] = state.C[key.slice(2)];
      else if (key.startsWith("PR:")) j.PR[key.slice(3)] = state.PR[key.slice(3)];
    }
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(j));
  } catch {
    /* storage full or blocked — server save still proceeds */
  }
}

function readJournal(): Journal | null {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Journal;
    if (!j || Date.now() - j.at > JOURNAL_MAX_AGE) {
      localStorage.removeItem(JOURNAL_KEY);
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

function applyJournal(): number {
  const j = readJournal();
  if (!j || j.date !== state.sessionDate || j.user !== state.curUser?.id) return 0;
  let count = 0;
  if (j.cfg) {
    state.cfg = normalizeConfig(j.cfg);
    count += 1;
  }
  if (j.meta) {
    state.leadName = String(j.meta.lead ?? "");
    state.cc = Math.min(99, Math.max(1, Number(j.meta.cc) || state.cc));
    count += 1;
  }
  for (const [key, value] of Object.entries(j.C || {})) {
    state.C[key] = normalizeCase(value, state.cfg);
    count += 1;
  }
  for (const [key, value] of Object.entries(j.PR || {})) {
    state.PR[key] = normalizeProcedureRoom(value);
    count += 1;
  }
  return count;
}

export function clearJournal(): void {
  try {
    localStorage.removeItem(JOURNAL_KEY);
  } catch {
    /* ignore */
  }
}

// ── Load ─────────────────────────────────────────────────────

function applyLoaded(data: LoadedSession): void {
  state.cfg = normalizeConfig(data.cfg);
  state.cc = Math.min(99, Math.max(1, Number(data.cc) || 4));
  state.leadName = data.lead || "";
  state.sessionDate = data.date || state.sessionDate;
  state.C = {};
  for (const [key, value] of Object.entries(data.C || {})) state.C[key] = normalizeCase(value, state.cfg);
  state.PR = {};
  for (const [key, value] of Object.entries(data.PR || {})) state.PR[key] = normalizeProcedureRoom(value);
  ensureCases();
}

export async function loadSession(): Promise<void> {
  const token = ++loadToken;
  clearSaveTimer();
  clearRetry();
  state.loading = true;
  hooks.onStatus();
  try {
    const data = await apiRequest<LoadedSession>(`/sessions?date=${encodeURIComponent(state.sessionDate)}`);
    if (token !== loadToken) return;
    applyLoaded(data);
    // Empty default rows the server hasn't stored yet count as clean; they are
    // saved on first edit, and another device's version is adopted otherwise.
    markAllSynced();
    const recovered = applyJournal();
    ensureCases();
    adoptNewRecords();
    setStatus("idle");
    if (recovered) {
      hooks.toast(`Recovered ${recovered === 1 ? "an unsaved change" : `${recovered} unsaved changes`} from this device.`, "info");
      scheduleSave(0);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      hooks.onAuthLost();
      return;
    }
    ensureCases();
    const recovered = applyJournal();
    setStatus(error instanceof NetworkError ? "offline" : "error", errorMessage(error));
    hooks.toast(recovered ? "Offline: showing unsaved changes stored on this device." : `Couldn't load the session. ${errorMessage(error)}`, "error");
  } finally {
    if (token === loadToken) state.loading = false;
  }
}

// ── Merge ────────────────────────────────────────────────────

/** Take server versions of every record this device hasn't changed. Returns true if anything changed. */
function mergeServer(data: LoadedSession): boolean {
  let changed = false;
  const take = (key: string, serverJson: string, apply: () => void) => {
    const local = currentJson(key);
    const base = synced.get(key);
    if (base === undefined || base === local) {
      // Not edited on this device: adopt the server version.
      if (serverJson !== local) {
        apply();
        changed = true;
      }
    }
    // The server copy becomes the baseline; a local edit stays dirty and wins on the next save.
    synced.set(key, serverJson);
  };

  const cfg = normalizeConfig(data.cfg);
  take("cfg", json(cfg), () => {
    state.cfg = cfg;
  });
  const meta = { lead: data.lead || "", cc: Math.min(99, Math.max(1, Number(data.cc) || state.cc)) };
  take("meta", json(meta), () => {
    state.leadName = meta.lead;
    state.cc = meta.cc;
  });
  for (const [key, value] of Object.entries(data.C || {})) {
    const record = normalizeCase(value, state.cfg);
    take(`C:${key}`, json(record), () => {
      state.C[key] = record;
    });
  }
  for (const [key, value] of Object.entries(data.PR || {})) {
    const room = normalizeProcedureRoom(value);
    take(`PR:${key}`, json(room), () => {
      state.PR[key] = room;
    });
  }
  if (changed) {
    ensureCases();
    adoptNewRecords();
  }
  return changed;
}

export async function refreshFromServer(): Promise<void> {
  if (!state.curUser || state.loading || state.saving) return;
  if (hasLocalChanges()) {
    if (saveTimer === null && retryTimer === null) void saveNow();
    return;
  }
  const date = state.sessionDate;
  try {
    const data = await apiRequest<LoadedSession>(`/sessions?date=${encodeURIComponent(date)}`);
    if (date !== state.sessionDate || state.saving) return;
    if (mergeServer(data)) hooks.onRemoteChange();
    if (state.saveStatus === "offline" || state.saveStatus === "error") setStatus(state.lastSavedAt ? "saved" : "idle");
  } catch (error) {
    if (error instanceof AuthError) hooks.onAuthLost();
    else if (error instanceof NetworkError && state.saveStatus !== "offline") setStatus("offline", errorMessage(error));
  }
}

// ── Save ─────────────────────────────────────────────────────

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function clearRetry(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Call after every mutation. `delay = 0` for timer actions that must persist immediately. */
export function scheduleSave(delay = DEBOUNCE_MS): void {
  if (!state.curUser) return;
  writeJournal();
  clearSaveTimer();
  if (state.saveStatus !== "offline") setStatus("dirty");
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, delay);
}

export async function saveNow(manual = false): Promise<void> {
  if (!state.curUser || state.loading) return;
  clearSaveTimer();
  if (state.saving) {
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void saveNow(manual);
    }, 250);
    return;
  }
  const dirty = dirtyKeys();
  if (!dirty.length) {
    clearJournal();
    if (manual) hooks.toast("Everything is saved.", "success");
    if (state.saveStatus !== "saved") setStatus(state.lastSavedAt ? "saved" : "idle");
    return;
  }

  const payload = {
    date: state.sessionDate,
    cc: state.cc,
    lead: state.leadName,
    cfg: state.cfg,
    C: {} as Record<string, CaseRecord>,
    PR: {} as Record<string, ProcedureRoom>,
  };
  const sent = new Map<string, string>();
  sent.set("cfg", currentJson("cfg"));
  sent.set("meta", currentJson("meta"));
  for (const key of dirty) {
    if (key.startsWith("C:")) {
      payload.C[key.slice(2)] = state.C[key.slice(2)];
      sent.set(key, currentJson(key));
    } else if (key.startsWith("PR:")) {
      payload.PR[key.slice(3)] = state.PR[key.slice(3)];
      sent.set(key, currentJson(key));
    }
  }

  const date = state.sessionDate;
  state.saving = true;
  setStatus("saving");
  try {
    const data = await apiRequest<LoadedSession>("/sessions", { method: "POST", body: JSON.stringify(payload) });
    if (date !== state.sessionDate) return;
    for (const [key, value] of sent) synced.set(key, value);
    const changed = mergeServer(data);
    retryIndex = 0;
    clearRetry();
    state.lastSavedAt = Date.now();
    writeJournal();
    if (hasLocalChanges()) {
      setStatus("dirty");
      scheduleSave(DEBOUNCE_MS);
    } else {
      setStatus("saved");
      if (manual) hooks.toast("All changes saved.", "success");
    }
    if (changed) hooks.onRemoteChange();
  } catch (error) {
    if (error instanceof AuthError) {
      setStatus("error", errorMessage(error));
      hooks.onAuthLost();
      return;
    }
    const offline = error instanceof NetworkError;
    setStatus(offline ? "offline" : "error", errorMessage(error));
    if (manual || !offline) hooks.toast(offline ? "Offline. Changes are kept on this device and will sync automatically." : `Save failed: ${errorMessage(error)}`, "error");
    scheduleRetry();
  } finally {
    state.saving = false;
  }
}

function scheduleRetry(): void {
  clearRetry();
  const delay = RETRY_STEPS[Math.min(retryIndex, RETRY_STEPS.length - 1)];
  retryIndex += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void saveNow();
  }, delay);
}

/** Save everything pending; resolves true when nothing is left unsaved. */
export async function flushSave(): Promise<boolean> {
  clearSaveTimer();
  for (let i = 0; i < 40 && state.saving; i += 1) await new Promise((r) => setTimeout(r, 150));
  if (hasLocalChanges()) await saveNow();
  return !hasLocalChanges();
}

// ── Lifecycle ────────────────────────────────────────────────

export function startSync(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void refreshFromServer();
  }, POLL_MS);
}

export function stopSync(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  clearSaveTimer();
  clearRetry();
}

export function initSyncListeners(): void {
  window.addEventListener("online", () => {
    retryIndex = 0;
    void (hasLocalChanges() ? saveNow() : refreshFromServer());
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshFromServer();
    else if (hasLocalChanges()) void saveNow();
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.curUser && hasLocalChanges()) {
      writeJournal();
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
