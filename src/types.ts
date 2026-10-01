import type { User } from "@supabase/supabase-js";

export type AppTab = "dash" | "roster" | "live" | "rooms" | "hist" | "settings";
export type RosterTab = "patient" | "assessment" | "preop" | "teams" | "procedure" | "postop";
export type SettingsTab = "staff" | "rooms" | "procRooms" | "procedures" | "checklist" | "clinic";
export type CaseStatus = "scheduled" | "in-progress" | "completed";
export type ProcedureRoomStatus = "available" | "occupied" | "completed";
export type Phase = "registration" | "preOp" | "anaesthesia" | "extraction" | "placing" | "dressing" | "postOp";
export type LivePhase = "anaesthesia" | "extraction" | "placing" | "dressing";

export interface Patient {
  name: string;
  age: string;
  gender: string;
  contact: string;
  bloodGroup: string;
  allergies: string;
  medications?: string;
}

export interface Assessment {
  norwoodScale: string;
  donorDensity: string;
  recipientArea: string;
  graftEstimate: string;
  procedureType: string;
  notes: string;
}

export interface PreOp {
  bp?: string;
  pulse?: string;
  spo2?: string;
  [key: string]: string | boolean | undefined;
}

/**
 * A procedural phase.
 * `startedAt` / `endedAt` (ISO) are the source of truth for timers.
 * `start` / `end` ("HH:MM") are kept in sync for backward compatibility with
 * rows written before timestamps existed.
 */
export interface ProcedurePhaseTime {
  start: string;
  end: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ExtractionProcedure extends ProcedurePhaseTime {
  grafts: number;
}

export interface PlacingProcedure extends ProcedurePhaseTime {
  hairline: number;
  middle: number;
  crown: number;
}

export interface Procedure {
  currentPhase: Phase;
  anaesthesia: ProcedurePhaseTime;
  extraction: ExtractionProcedure;
  placing: PlacingProcedure;
  dressing: ProcedurePhaseTime;
}

export interface PostOp {
  prescriptions: string;
  followUpDate: string;
  dischargeTime: string;
}

export type TeamRows = Record<string, string[]>;
export type Teams = Record<string, TeamRows>;

export interface CaseRecord {
  patient: Patient;
  assessment: Assessment;
  preOp: PreOp;
  procedure: Procedure;
  postOp: PostOp;
  teams: Teams;
  startTime: string;
  endTime: string;
  status: CaseStatus;
}

export interface CompletedCaseArchive {
  roomKey: string;
  roomName: string;
  dischargedAt: string;
  /** ISO timestamp of discharge (added in the redesign; older entries only have `dischargedAt` HH:MM). */
  dischargedAtIso?: string;
  record: CaseRecord;
}

export type ProcedureRoomPatient = Omit<Patient, "medications"> & {
  /** ISO timestamp the procedure started in this room. */
  startedAt?: string;
  /** ISO timestamp the procedure was completed. */
  endedAt?: string;
};

export interface ProcedureQueueItem {
  patient: Omit<Patient, "medications">;
  procedure: string;
  notes: string;
  addedAt: string;
}

export interface ProcedureRoom {
  patient: ProcedureRoomPatient;
  assignee: string;
  procedure: string;
  notes: string;
  status: ProcedureRoomStatus;
  queue: ProcedureQueueItem[];
}

export interface CompletedProcedureArchive {
  roomKey: string;
  roomName: string;
  clearedAt: string;
  room: Omit<ProcedureRoom, "queue">;
}

export interface ChecklistItem {
  k: string;
  l: string;
  s: string;
}

export interface AppConfig {
  staff: string[];
  rooms: string[];
  roomLeads: string[];
  completedCases: CompletedCaseArchive[];
  completedProcedureRooms?: CompletedProcedureArchive[];
  procedures: string[];
  checks: ChecklistItem[];
  procRooms: string[];
  clinicName: string;
  clinicPhone: string;
  clinicEmail: string;
}

export interface TeamDefinition {
  k: string;
  l: string;
  r: Array<{ k: string; l: string }>;
}

export interface SessionPayload {
  date: string;
  cc: number;
  C: Record<string, CaseRecord>;
  PR: Record<string, ProcedureRoom>;
  cfg: AppConfig;
  lead: string;
}

export interface LoadedSession extends SessionPayload {
  id?: string;
  full?: boolean;
  summary?: { caseCount: number; doneCount: number; grafts: number };
}

export interface HistoryResponse {
  sessions: LoadedSession[];
}

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "offline";

export interface AppState {
  curUser: User | null;
  currentTab: AppTab;
  selectedCase: string;
  selectedRosterTab: RosterTab;
  selectedProcRoom: string;
  cfgTab: SettingsTab;
  loading: boolean;
  saving: boolean;
  saveStatus: SaveStatus;
  saveError: string;
  lastSavedAt: number;
  historyRows: LoadedSession[];
  historyLoadedAt: number;
  historyLoading: boolean;
  historyError: string;
  cc: number;
  sessionDate: string;
  leadName: string;
  C: Record<string, CaseRecord>;
  PR: Record<string, ProcedureRoom>;
  cfg: AppConfig;
}
