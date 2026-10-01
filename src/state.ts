import type {
  AppConfig,
  AppState,
  CaseRecord,
  ChecklistItem,
  LivePhase,
  Phase,
  ProcedureRoom,
  SessionPayload,
  TeamDefinition,
  Teams,
} from "./types";

export const PH: Phase[] = ["registration", "preOp", "anaesthesia", "extraction", "placing", "dressing", "postOp"];
export const LIVE_PHASES: LivePhase[] = ["anaesthesia", "extraction", "placing", "dressing"];

export const PHL: Record<Phase, string> = {
  registration: "Registration",
  preOp: "Pre-Op",
  anaesthesia: "Anaesthesia",
  extraction: "Extraction",
  placing: "Placing",
  dressing: "Dressing",
  postOp: "Post-Op",
};

/** Which teams are working during each live phase (as used on the original Live Floor). */
export const PHASE_TEAMS: Record<LivePhase, string[]> = {
  anaesthesia: ["anaesthesia"],
  extraction: ["extraction", "arrangement"],
  placing: ["placing"],
  dressing: ["shower", "dressing"],
};

export const TD: TeamDefinition[] = [
  { k: "anaesthesia", l: "Anaesthesia", r: [{ k: "leads", l: "Lead" }, { k: "assistants", l: "Assistants" }] },
  { k: "extraction", l: "Extraction", r: [{ k: "members", l: "Team" }] },
  { k: "placing", l: "Placing", r: [{ k: "hairline", l: "Hairline" }, { k: "middle", l: "Middle" }, { k: "crown", l: "Crown" }] },
  { k: "arrangement", l: "Arrangement", r: [{ k: "members", l: "Team" }] },
  { k: "shower", l: "Shower", r: [{ k: "members", l: "Team" }] },
  { k: "dressing", l: "Dressing", r: [{ k: "members", l: "Team" }] },
];

export const DEF_STAFF = ["Huzaifa", "Luqman", "Salman", "Asim", "Wahab", "Adnan", "Bilal", "Afaq", "Ali Baz", "Basit", "Zia"];
export const DEF_ROOMS = ["OT Room 1", "OT Room 2", "OT Room 3", "OT Room 4", "OT Room 5"];
export const DEF_PROCS = ["Nano Sapphire FUE", "FUE", "FUT", "DHI"];
export const DEF_PROC_ROOMS = ["Procedure Room 1", "Procedure Room 2"];

export const DEF_CHECKS: ChecklistItem[] = [
  { k: "consent", l: "Consent Form Signed", s: "Patient consent obtained and documented" },
  { k: "hairlineApproved", l: "Hairline Design Approved", s: "Hairline marking reviewed and signed off" },
  { k: "labReports", l: "Lab Reports Clear", s: "Blood work and tests within normal range" },
  { k: "preOpPhotos", l: "Pre-Op Photos Taken", s: "Before photos captured from all angles" },
  { k: "vitalsCleared", l: "Vitals Cleared", s: "BP, Pulse, SpO2 within safe range" },
];

/** Local calendar date (YYYY-MM-DD). The original used UTC, which is the previous day before 05:00 in Pakistan. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultConfig(): AppConfig {
  return {
    staff: [...DEF_STAFF],
    rooms: [...DEF_ROOMS],
    roomLeads: [],
    completedCases: [],
    completedProcedureRooms: [],
    procedures: [...DEF_PROCS],
    checks: DEF_CHECKS.map((check) => ({ ...check })),
    procRooms: [...DEF_PROC_ROOMS],
    clinicName: "MSK Aesthetics",
    clinicPhone: "+92 306 5577753",
    clinicEmail: "info@mskaesthetics.com",
  };
}

export function defaultTeams(): Teams {
  return {
    anaesthesia: { leads: ["Huzaifa"], assistants: ["Luqman", "Salman"] },
    extraction: { members: ["Asim", "Wahab"] },
    placing: { hairline: ["Huzaifa", "Adnan"], middle: ["Bilal", "Afaq"], crown: ["Asim", "Wahab"] },
    arrangement: { members: ["Ali Baz", "Basit", "Zia"] },
    shower: { members: ["Luqman", "Salman"] },
    dressing: { members: ["Huzaifa", "Adnan", "Salman"] },
  };
}

export function defaultCase(cfg: AppConfig): CaseRecord {
  const record: CaseRecord = {
    patient: { name: "", age: "", gender: "", contact: "", bloodGroup: "", allergies: "", medications: "" },
    assessment: {
      norwoodScale: "",
      donorDensity: "",
      recipientArea: "",
      graftEstimate: "",
      procedureType: cfg.procedures[0] || "FUE",
      notes: "",
    },
    preOp: {},
    procedure: {
      currentPhase: "registration",
      anaesthesia: { start: "", end: "" },
      extraction: { start: "", end: "", grafts: 0 },
      placing: { start: "", end: "", hairline: 0, middle: 0, crown: 0 },
      dressing: { start: "", end: "" },
    },
    postOp: { prescriptions: "", followUpDate: "", dischargeTime: "" },
    teams: defaultTeams(),
    startTime: "",
    endTime: "",
    status: "scheduled",
  };
  cfg.checks.forEach((check) => {
    record.preOp[check.k] = false;
  });
  return record;
}

export function defaultProcedureRoom(): ProcedureRoom {
  return {
    patient: { name: "", age: "", gender: "", contact: "", bloodGroup: "", allergies: "" },
    assignee: "",
    procedure: "",
    notes: "",
    status: "available",
    queue: [],
  };
}

export const state: AppState = {
  curUser: null,
  currentTab: "dash",
  selectedCase: "case1",
  selectedRosterTab: "patient",
  selectedProcRoom: "",
  cfgTab: "staff",
  loading: false,
  saving: false,
  saveStatus: "idle",
  saveError: "",
  lastSavedAt: 0,
  historyRows: [],
  historyLoadedAt: 0,
  historyLoading: false,
  historyError: "",
  cc: 4,
  sessionDate: today(),
  leadName: "",
  C: {},
  PR: {},
  cfg: defaultConfig(),
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function phaseTime(value: unknown): { start: string; end: string; startedAt?: string; endedAt?: string } {
  const p = obj(value);
  const out: { start: string; end: string; startedAt?: string; endedAt?: string } = { start: str(p.start), end: str(p.end) };
  if (typeof p.startedAt === "string" && p.startedAt) out.startedAt = p.startedAt;
  if (typeof p.endedAt === "string" && p.endedAt) out.endedAt = p.endedAt;
  return out;
}

/**
 * Fill every field a view reads, so partially saved or older rows never render
 * `undefined` / `NaN`. Unknown keys are preserved.
 */
export function normalizeCase(raw: unknown, cfg: AppConfig): CaseRecord {
  const base = defaultCase(cfg);
  const r = obj(raw);
  const proc = obj(r.procedure);
  const extraction = obj(proc.extraction);
  const placing = obj(proc.placing);
  const phase = str(proc.currentPhase) as Phase;
  const teams = obj(r.teams);
  return {
    ...(r as object),
    patient: { ...base.patient, ...(obj(r.patient) as object) } as CaseRecord["patient"],
    assessment: { ...base.assessment, ...(obj(r.assessment) as object) } as CaseRecord["assessment"],
    preOp: { ...base.preOp, ...(obj(r.preOp) as object) },
    procedure: {
      ...(proc as object),
      currentPhase: PH.includes(phase) ? phase : "registration",
      anaesthesia: phaseTime(proc.anaesthesia),
      extraction: { ...phaseTime(extraction), grafts: num(extraction.grafts) },
      placing: { ...phaseTime(placing), hairline: num(placing.hairline), middle: num(placing.middle), crown: num(placing.crown) },
      dressing: phaseTime(proc.dressing),
    },
    postOp: { ...base.postOp, ...(obj(r.postOp) as object) } as CaseRecord["postOp"],
    teams: Object.keys(teams).length ? (teams as Teams) : base.teams,
    startTime: str(r.startTime),
    endTime: str(r.endTime),
    status: (["scheduled", "in-progress", "completed"].includes(str(r.status)) ? str(r.status) : "scheduled") as CaseRecord["status"],
  } as CaseRecord;
}

export function normalizeProcedureRoom(raw: unknown): ProcedureRoom {
  const base = defaultProcedureRoom();
  const r = obj(raw);
  const status = str(r.status);
  return {
    ...(r as object),
    patient: { ...base.patient, ...(obj(r.patient) as object) } as ProcedureRoom["patient"],
    assignee: str(r.assignee),
    procedure: str(r.procedure),
    notes: str(r.notes),
    status: (["available", "occupied", "completed"].includes(status) ? status : "available") as ProcedureRoom["status"],
    queue: Array.isArray(r.queue) ? (r.queue as ProcedureRoom["queue"]) : [],
  } as ProcedureRoom;
}

export function normalizeConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  const c = obj(raw);
  const arr = <T>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? (value as T[]) : fallback);
  return {
    ...(c as object),
    staff: arr<string>(c.staff, base.staff),
    rooms: arr<string>(c.rooms, base.rooms),
    roomLeads: arr<string>(c.roomLeads, []),
    completedCases: arr(c.completedCases, []),
    completedProcedureRooms: arr(c.completedProcedureRooms, []),
    procedures: arr<string>(c.procedures, base.procedures),
    checks: arr<ChecklistItem>(c.checks, base.checks),
    procRooms: arr<string>(c.procRooms, base.procRooms),
    clinicName: str(c.clinicName ?? base.clinicName),
    clinicPhone: str(c.clinicPhone ?? base.clinicPhone),
    clinicEmail: str(c.clinicEmail ?? base.clinicEmail),
  } as AppConfig;
}

/** Make sure every visible OT room and procedure room has a record. */
export function ensureCases(): void {
  for (let i = 1; i <= state.cc; i += 1) {
    const key = `case${i}`;
    if (!state.C[key]) state.C[key] = defaultCase(state.cfg);
    if (!state.cfg.rooms[i - 1]) state.cfg.rooms[i - 1] = `OT Room ${i}`;
  }
  if (!state.cfg.procRooms.length) state.cfg.procRooms = [...DEF_PROC_ROOMS];
  state.cfg.procRooms.forEach((_, index) => {
    const key = `pr${index + 1}`;
    if (!state.PR[key]) state.PR[key] = defaultProcedureRoom();
  });
}

export function caseKeys(): string[] {
  return Array.from({ length: state.cc }, (_, i) => `case${i + 1}`);
}

export function procRoomKeys(): string[] {
  return state.cfg.procRooms.map((_, i) => `pr${i + 1}`);
}

export function sessionPayload(): SessionPayload {
  return {
    date: state.sessionDate,
    cc: state.cc,
    C: state.C,
    PR: state.PR,
    cfg: state.cfg,
    lead: state.leadName,
  };
}

export function phaseIndex(phase: string): number {
  return PH.indexOf(phase as Phase);
}

export function caseIndex(key: string): number {
  return Number(key.replace("case", "")) || 1;
}

export function roomName(index: number): string {
  return state.cfg.rooms[index - 1] || `OT Room ${index}`;
}

export function roomShort(index: number): string {
  return `OT ${index}`;
}

export function roomLead(index: number): string {
  return state.cfg.roomLeads?.[index - 1] || "";
}

export function prName(index: number): string {
  return state.cfg.procRooms[index - 1] || `Procedure Room ${index}`;
}

export function preOpCount(record: CaseRecord, checks = state.cfg.checks): number {
  return checks.filter((check) => Boolean(record.preOp?.[check.k])).length;
}
