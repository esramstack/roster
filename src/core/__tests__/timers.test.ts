import { describe, expect, it } from "vitest";
import { defaultCase, defaultConfig } from "../../state";
import type { CaseRecord } from "../../types";
import { caseView } from "../derive";
import { caseSpan, fmtClock, fmtDur, legacyMs, phaseSpan, spanMs, spanState } from "../time";
import { applyClear, applyEdit, applyEnd, applyStart, checkEdit, checkEnd, checkStart } from "../timers";

const DATE = "2026-10-01";
const T0 = new Date(2026, 9, 1, 9, 12, 0).getTime();
const MIN = 60_000;

function registered(): CaseRecord {
  const r = defaultCase(defaultConfig());
  r.patient.name = "Test Patient";
  return r;
}

/** Simulates save → reload: the record only survives as JSON. */
const reload = (r: CaseRecord): CaseRecord => JSON.parse(JSON.stringify(r));

describe("span calculation", () => {
  it("uses ISO timestamps as the source of truth", () => {
    const span = phaseSpan({ start: "09:12", end: "", startedAt: new Date(T0).toISOString() }, DATE);
    expect(span.startMs).toBe(T0);
    expect(span.approx).toBe(false);
    expect(spanState(span)).toBe("active");
    expect(spanMs(span, T0 + 94 * MIN + 22_000)).toBe(94 * MIN + 22_000);
  });

  it("reads legacy HH:MM data on the session date and flags it approximate", () => {
    const span = phaseSpan({ start: "09:12", end: "09:28" }, DATE);
    expect(span.startMs).toBe(T0);
    expect(span.endMs).toBe(T0 + 16 * MIN);
    expect(span.approx).toBe(true);
    expect(fmtDur(spanMs(span))).toBe("16 min");
  });

  it("handles legacy phases crossing midnight", () => {
    const span = phaseSpan({ start: "23:40", end: "00:25" }, DATE);
    expect(spanMs(span)).toBe(45 * MIN);
  });

  it("never returns NaN or negative values", () => {
    expect(phaseSpan({ start: "banana", end: "25:99" }, DATE)).toEqual({ startMs: null, endMs: null, approx: false });
    expect(spanMs({ startMs: T0, endMs: T0 - MIN, approx: false })).toBe(0);
    expect(spanState({ startMs: null, endMs: T0, approx: false })).toBe("invalid");
    expect(spanState({ startMs: T0, endMs: T0 - 1, approx: false })).toBe("invalid");
    expect(legacyMs("09:12", "not-a-date")).toBeNull();
  });

  it("formats clock and durations", () => {
    expect(fmtClock(1 * 3600_000 + 34 * MIN + 22_000)).toBe("01:34:22");
    expect(fmtClock(-5)).toBe("00:00:00");
    expect(fmtDur(84 * MIN)).toBe("1h 24m");
    expect(fmtDur(120 * MIN)).toBe("2h");
    expect(fmtDur(20_000)).toBe("<1 min");
  });
});

describe("phase state machine", () => {
  it("starts a phase with an exact timestamp and survives reload", () => {
    const r = registered();
    const c = checkStart(r, "anaesthesia", DATE, 5, 5);
    expect(c.ok).toBe(true);
    applyStart(r, "anaesthesia", T0, null);
    const back = reload(r);
    expect(back.procedure.anaesthesia.startedAt).toBe(new Date(T0).toISOString());
    expect(back.procedure.anaesthesia.start).toBe("09:12");
    expect(back.status).toBe("in-progress");
    const v = caseView("case1", back, DATE, []);
    expect(v.active).toBe("anaesthesia");
    expect(spanMs(v.spans.anaesthesia, T0 + 3 * 3600_000)).toBe(3 * 3600_000);
  });

  it("rejects starting without a registered patient", () => {
    const r = defaultCase(defaultConfig());
    const c = checkStart(r, "anaesthesia", DATE, 0, 0);
    expect(c.ok).toBe(false);
  });

  it("rejects duplicate start (double click) and restarting a completed phase", () => {
    const r = registered();
    applyStart(r, "extraction", T0, null);
    const dup = checkStart(r, "extraction", DATE, 0, 0);
    expect(dup.ok).toBe(false);
    applyEnd(r, "extraction", T0 + 90 * MIN);
    const again = checkStart(reload(r), "extraction", DATE, 0, 0);
    expect(again.ok).toBe(false);
  });

  it("ends the running phase when the next one starts (one active phase)", () => {
    const r = registered();
    applyStart(r, "anaesthesia", T0, null);
    const c = checkStart(r, "extraction", DATE, 5, 5);
    expect(c.ok && c.endsActive).toBe("anaesthesia");
    if (!c.ok) return;
    applyStart(r, "extraction", T0 + 18 * MIN, c.endsActive);
    const v = caseView("case1", reload(r), DATE, []);
    expect(v.states.anaesthesia).toBe("done");
    expect(spanMs(v.spans.anaesthesia)).toBe(18 * MIN);
    expect(v.active).toBe("extraction");
  });

  it("warns about skipped phases and incomplete pre-op, without blocking", () => {
    const r = registered();
    const c = checkStart(r, "extraction", DATE, 3, 5);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.warnings.join(" ")).toMatch(/Anaesthesia has no recorded times/);
    const a = checkStart(r, "anaesthesia", DATE, 3, 5);
    if (a.ok) expect(a.warnings.join(" ")).toMatch(/3 \/ 5/);
  });

  it("rejects end without start, double end, and a device clock behind the start", () => {
    const r = registered();
    expect(checkEnd(r, "placing", DATE, T0).ok).toBe(false);
    applyStart(r, "placing", T0, null);
    expect(checkEnd(r, "placing", DATE, T0 - MIN).ok).toBe(false);
    expect(checkEnd(r, "placing", DATE, T0 + MIN).ok).toBe(true);
    applyEnd(r, "placing", T0 + 40 * MIN);
    expect(checkEnd(r, "placing", DATE, T0 + 41 * MIN).ok).toBe(false);
  });

  it("keeps a completed timer completed and frozen after reload", () => {
    const r = registered();
    applyStart(r, "dressing", T0, null);
    applyEnd(r, "dressing", T0 + 25 * MIN);
    const v = caseView("case1", reload(r), DATE, []);
    expect(v.states.dressing).toBe("done");
    expect(spanMs(v.spans.dressing, T0 + 999 * MIN)).toBe(25 * MIN);
    expect(r.procedure.currentPhase).toBe("postOp");
  });

  it("validates manual edits", () => {
    const r = registered();
    const now = T0 + 5 * 3600_000;
    expect(checkEdit(r, "extraction", null, T0, DATE, now).ok).toBe(false);
    expect(checkEdit(r, "extraction", T0 + MIN, T0, DATE, now).ok).toBe(false);
    expect(checkEdit(r, "extraction", now + 10 * MIN, null, DATE, now).ok).toBe(false);
    expect(checkEdit(r, "extraction", T0, T0 + 30 * MIN, DATE, now).ok).toBe(true);
    applyStart(r, "anaesthesia", T0, null);
    // Leaving extraction open while anaesthesia still runs would create two live phases.
    expect(checkEdit(r, "extraction", T0, null, DATE, now).ok).toBe(false);
    applyEdit(r, "anaesthesia", T0, T0 + 10 * MIN);
    expect(caseView("case1", r, DATE, []).states.anaesthesia).toBe("done");
    applyClear(r, "anaesthesia");
    expect(caseView("case1", r, DATE, []).states.anaesthesia).toBe("idle");
  });
});

describe("overall case timer", () => {
  it("runs from the first start until dressing ends", () => {
    const r = registered();
    applyStart(r, "anaesthesia", T0, null);
    applyEnd(r, "anaesthesia", T0 + 16 * MIN);
    applyStart(r, "extraction", T0 + 18 * MIN, null);
    let span = caseSpan(r, DATE);
    expect(span.endMs).toBeNull();
    expect(spanMs(span, T0 + 60 * MIN)).toBe(60 * MIN);
    applyEnd(r, "extraction", T0 + 100 * MIN);
    // Between phases the case is still running.
    expect(caseSpan(r, DATE).endMs).toBeNull();
    applyStart(r, "placing", T0 + 105 * MIN, null);
    applyEnd(r, "placing", T0 + 200 * MIN);
    applyStart(r, "dressing", T0 + 205 * MIN, null);
    applyEnd(r, "dressing", T0 + 225 * MIN);
    span = caseSpan(reload(r), DATE);
    expect(span.endMs).toBe(T0 + 225 * MIN);
    expect(fmtDur(spanMs(span, T0 + 9999 * MIN))).toBe("3h 45m");
  });
});
