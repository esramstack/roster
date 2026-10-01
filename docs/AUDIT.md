# Pre-redesign audit

Audit of the MSK Duty Roster codebase as received (`Msk-Duty-Roaster--main`), done before any change. The original code is preserved as the first git commit.

## Architecture

| Layer | What it does |
|---|---|
| `index.html` + `src/main.ts` | Static shell (login, sidebar, topbar), boots `initApp()` |
| `src/render.ts` (2,143 lines) | Every view, every action, save logic, dialogs, toasts, history |
| `src/state.ts` | Defaults, the global mutable `state`, small derivations |
| `src/api.ts` | Supabase Auth (email/password) and `apiRequest()` to the Edge Function with the user's JWT |
| `src/ui/controls.ts` | Custom select and HH:MM time picker, committing through `window.dsa` |
| `supabase/functions/dsa-api` | Router: `GET/POST /sessions`, `GET /history`, `PATCH /cases/:key`, `PATCH /procedure-rooms/:key` (service role, audit log) |
| Postgres | `daily_sessions` (one row per date, `config` jsonb), `cases` (one row per OT room, jsonb columns), `procedure_rooms` (jsonb patient, `queue` jsonb), `audit_events`, `profiles` |

### Persistence flow
1. Login → `loadSession()` → `GET /sessions?date=` → `state.C`, `state.PR`, `state.cfg`.
2. Every edit → `scheduleSave()` (800 ms debounce) → `POST /sessions` with the **whole** session (all cases, all procedure rooms, full config).
3. The Edge Function upserts the session row, then upserts every case and procedure-room row sent. Rows are never deleted.
4. Only `POST /sessions` is used by the frontend; the `PATCH` routes exist but are unused.

### Archive / restore
Discharge copies the case into `cfg.completedCases[]` (inside `daily_sessions.config`) and resets the OT room to an empty case. History reads both live case rows and this archive. "Load This Session" reloads a past date into the working views.

## Timer audit

Every timer-related field and code path:

| Location | Storage | Behaviour |
|---|---|---|
| `procedure.anaesthesia/extraction/placing/dressing.start/end` | `"HH:MM"` string in `cases.procedure` jsonb | Set by Start/End buttons from the device clock, or typed via the time picker |
| `record.startTime` / `record.endTime` | `"HH:MM"` strings | Manually entered **scheduled** times, not timers |
| `postOp.dischargeTime` | `"HH:MM"` | Manual or set on discharge |
| `ProcedureQueueItem.addedAt` | ISO timestamp | Stored but never displayed |
| Procedure rooms | none | No timing at all |
| `tick()` | — | Only the topbar wall clock |

**There was no running timer anywhere in the app.** The Live Floor showed the start and end strings; nothing computed elapsed time.

### Problems found
1. **No date or seconds in phase times.** `"09:12"` cannot produce a correct elapsed time after refresh, across midnight, or for a case reopened from History.
2. **"Restart" silently overwrote a running phase.** The Start button stayed enabled on an active phase, relabelled "Restart", and replaced its start time.
3. **End without a real start.** `endPhase` quietly set `start = end`, producing a zero-length phase instead of rejecting the action.
4. **Several phases could run at once.** Nothing prevented starting Placing while Extraction was active.
5. **Time picker allowed end before start**, giving negative durations.
6. **Timer actions waited on the 800 ms debounce.** A refresh straight after Start could lose it; there was no local recovery.
7. **One bad field blocked every save.** `validateSessionForSave()` aborted the whole save if any room had an invalid contact/age, so timers in every other room stopped persisting.
8. **Whole-session overwrite between devices.** Each save re-sent every case. Two tablets on the floor would overwrite each other's timers with stale copies; there was no refresh from the server either.
9. **`today()` used UTC.** In Pakistan (UTC+5) the app opened the previous day's session between 00:00 and 05:00.

## Changes made to address them

| Problem | Fix |
|---|---|
| 1 | Phases now also store ISO `startedAt` / `endedAt`. The legacy `start` / `end` strings are still written, so old code, History and existing rows keep working. Old HH:MM-only data is read as the session date + time and marked approximate. |
| 2–5 | One validated state machine in `src/core/timers.ts`: Start only from not-started, End only from active, one active phase per case, confirmation for ending, time edits validated (end ≥ start, not in the future). |
| 6 | Timer actions save immediately, and all unsaved edits are journalled to `localStorage` and replayed after refresh / crash / offline. |
| 7 | Field validation is shown inline and no longer blocks saving. |
| 8 | Saves send only the cases/rooms that changed; the app polls the server every 15 s and merges any record not edited locally. |
| 9 | Local-date helper. |

### Schema / contract changes
**None.** No migration, no Edge Function change. New fields live inside existing jsonb columns:

- `cases.procedure.<phase>.startedAt / endedAt` (ISO strings)
- `procedure_rooms.patient.startedAt / endedAt` (ISO strings) for the procedure-room timer
- `daily_sessions.config.completedProcedureRooms[]`: archive of cleared procedure-room patients, parallel to the existing `completedCases[]`

The deployed Edge Function passes these through unchanged (it deep-merges / stores jsonb as given).

### Known remaining risk
`daily_sessions.config` (settings + discharge archive) is still written whole on every save, because the Edge Function requires it. Two devices changing **settings** or **discharging** within the same ~15 s window can still overwrite each other. Recommended follow-up: let `upsertSession` keep the stored config when `cfg` is omitted, and move the discharge archive to its own table.
