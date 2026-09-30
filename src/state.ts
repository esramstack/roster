import type {
  AppConfig,
  AppState,
  CaseRecord,
  ChecklistItem,
  Phase,
  ProcedureRoom,
  SessionPayload,
  StatusView,
  TeamDefinition,
  Teams,
} from "./types";

export const PH: Phase[] = ["registration", "preOp", "anaesthesia", "extraction", "placing", "dressing", "postOp"];

export const PHL: Record<Phase, string> = {
  registration: "Registered",
  preOp: "Pre-Op",
  anaesthesia: "Anaesthesia",
  extraction: "Extraction",
  placing: "Placing",
  dressing: "Dressing",
  postOp: "Post-Op",
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

export const DEF_CHECKS: ChecklistItem[] = [
  { k: "consent", l: "Consent Form Signed", s: "Patient consent obtained and documented" },
  { k: "hairlineApproved", l: "Hairline Design Approved", s: "Hairline marking reviewed and signed off" },
  { k: "labReports", l: "Lab Reports Clear", s: "Blood work and tests within normal range" },
  { k: "preOpPhotos", l: "Pre-Op Photos Taken", s: "Before photos captured from all angles" },
  { k: "vitalsCleared", l: "Vitals Cleared", s: "BP, Pulse, SpO2 within safe range" },
];

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultConfig(): AppConfig {
  return {
    staff: [...DEF_STAFF],
    rooms: [...DEF_ROOMS],
    roomLeads: [],
    completedCases: [],
    procedures: [...DEF_PROCS],
    checks: DEF_CHECKS.map((check) => ({ ...check })),
    procRooms: ["Procedure Room 1", "Procedure Room 2"],
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
  return {
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
  dashboardDetail: "hidden",
  cfgTab: "staff",
  roomModalOpen: false,
  saveTimer: null,
  loading: false,
  saving: false,
  saveStatus: "idle",
  saveError: "",
  historyRows: [],
  historyDetailDate: "",
  historyLoadedAt: 0,
  historyLoading: false,
  liveOpenCases: {},
  cc: 4,
  sessionDate: today(),
  leadName: "",
  C: {},
  PR: { pr1: defaultProcedureRoom(), pr2: defaultProcedureRoom() },
  cfg: defaultConfig(),
};

export function ensureCases(): void {
  for (let i = 1; i <= state.cc; i += 1) {
    const key = `case${i}`;
    if (!state.C[key]) {
      const nextCase = defaultCase(state.cfg);
      state.cfg.checks.forEach((check) => {
        nextCase.preOp[check.k] = false;
      });
      state.C[key] = nextCase;
    }
  }

  if (!state.PR.pr1) state.PR.pr1 = defaultProcedureRoom();
  if (!state.PR.pr2) state.PR.pr2 = defaultProcedureRoom();
  Object.values(state.PR).forEach((room) => {
    if (!Array.isArray(room.queue)) room.queue = [];
  });
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

export function roomName(index: number): string {
  return state.cfg.rooms[index - 1] || `OT Room ${index}`;
}

export function prName(index: number): string {
  return state.cfg.procRooms[index - 1] || `Procedure Room ${index}`;
}

export function statusInfo(record: CaseRecord): StatusView {
  const cur = phaseIndex(record.procedure.currentPhase);
  if (record.status === "completed") return ["done", "Done"];
  if (cur > 0) return ["active", "Active"];
  return ["scheduled", "Scheduled"];
}

export function preOpCount(record: CaseRecord): number {
  return state.cfg.checks.filter((check) => Boolean(record.preOp?.[check.k])).length;
}

export function graftTotal(record: CaseRecord): number {
  return Number(record.procedure?.extraction?.grafts || 0);
}

export function placedTotal(record: CaseRecord): number {
  const placing = record.procedure?.placing;
  return Number(placing.hairline || 0) + Number(placing.middle || 0) + Number(placing.crown || 0);
}

export function mergeLoadedConfig(loaded: Partial<AppConfig> | undefined): void {
  state.cfg = { ...state.cfg, ...(loaded ?? {}) };
}
