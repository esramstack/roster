# Regression plan and results

The redesign is only complete if every workflow the original app supported still works. This document lists those workflows, how each is tested, and the result on the final build.

## How to run

```bash
npm install
npm test                                   # timer engine unit tests (Vitest)
npm run build                              # strict TypeScript check + production build
npm run dev:mock -- --port 5174            # app against an in-browser test backend
python3 tests/e2e/regression.py            # end-to-end suite (needs: pip install playwright)
```

The end-to-end suite drives a real Chromium browser in the Asia/Karachi time zone against `src/mock/mockBackend.ts`. The mock implements the same `/sessions`, `/history` and auth contract as the `dsa-api` Edge Function and stores data the way Postgres does (one session row, one row per case and per procedure room, jsonb fields), so a test can check what was persisted as well as what is on screen. It is only bundled when `VITE_MOCK_API=1`; production builds talk to Supabase as before.

## Results on the final build

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`, strict) | Pass |
| Production build | Pass |
| Timer engine unit tests | 14 / 14 |
| End-to-end regression | 62 / 62 |
| Visual check, 7 screens at 1440 / 1024 / 390 px | No page errors, no horizontal overflow |

## Coverage

Each line is an automated check unless marked *(manual)*.

### Authentication
- Protected views hidden when signed out
- Invalid login rejected with a message
- Login works; session persists across refresh
- Logout works (with unsaved-change flush and confirmation)

### Session and daily roster
- Session lead saves and reloads
- Correct OT rooms load (5 seeded)
- Existing session data survives refresh

### Patient and assessment
- Patient saves to the correct OT room
- Inline validation appears next to the field and no longer blocks saving other rooms
- Procedure, Norwood, recipient area and graft estimate save and reload

### Pre-op
- Checklist toggles and vitals save
- Readiness count updates (`4 / 5 Ready`)
- Custom checklist items from Settings appear and save

### Team assignment
- Staff added and removed across stages, including Hairline, Middle and Crown
- Assignments survive refresh
- Cross-room double booking flagged on the Overview *(visual)*

### HT timers
For Anaesthesia, Extraction, Placing and Dressing:
- Start writes an exact ISO timestamp and saves immediately, not after the debounce
- Elapsed time increases
- Timer continues after leaving the page and after a full browser refresh
- Start timestamp is unchanged by refresh
- Overview, Roster and Live Floor show the same value from the same stored start
- End writes an exact timestamp; the completed timer stays completed and frozen after refresh
- Overall case timer runs from the first phase start until Dressing ends

### Timer edge cases
- Double-click Start does not create a second start
- End button is visibly disabled for about 0.7 s after Start, then re-enables
- Starting the next phase ends the running one at the same instant (one active phase)
- End before start is rejected in the time editor
- Updating one OT room does not touch another room's timers
- Two or more rooms run independent timers
- Device asleep for hours: a 3 h clock jump shows exactly now minus stored start
- Crossing midnight: a further 20 h jump keeps counting past 23 h
- Start timestamp never rewritten by a clock jump
- Offline Start is journalled on the device, survives refresh, and syncs when back online
- Legacy `HH:MM` data reads on the session date, handles midnight, and is marked approximate (unit)
- No NaN or negative values (unit)

### Graft tracking
- Extraction and zone counters work; step size 1 / 10 / 50 / 100
- Counters never go below zero
- Placed greater than extracted is flagged
- Total placed and remaining derived correctly; values persist

### Post-op and discharge
- Prescriptions and follow-up save
- Completion summary with phase durations shown before discharge
- Discharge archives the full case (timeline, teams, grafts) with nothing lost
- OT room is cleared afterwards

### Procedure rooms
- Queue add, reorder and call-in
- Call-in assigns the patient and marks the room occupied
- Procedure timer start persists
- Complete moves the room to awaiting turnover; turnover frees it and keeps the queue
- Completed procedure is archived

### History
- Sessions appear; search works; status filter works
- A historical case opens as a read-only summary with team, timeline and grafts
- Historical timers do not run
- Load-session (reopen a past day) still works *(manual)*

### Settings
- Staff, checklist and procedure-room configuration work
- Configuration remains after refresh

### Navigation
- Sidebar routes to all six areas; collapses on desktop, drawer on tablet and phone *(visual)*
- `/` focuses search *(manual)*
- No uncaught page errors across the whole run

## Not covered by automation

These need a pass against the real Supabase project before go-live:

1. Two tablets editing the same day at once (the 15 s merge and conflict handling).
2. Settings or discharge changed on two devices within the same 15 s window. `daily_sessions.config` is still written whole; see the known risk in `AUDIT.md`.
3. A real expired Supabase token mid-shift (the mock simulates the 401 path only).
