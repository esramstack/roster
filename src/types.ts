import type { User } from "@supabase/supabase-js";

export type AppTab = "dash" | "roster" | "live" | "settings" | "hist";
export type RosterTab = "patient" | "preop" | "teams" | "postop";
export type SettingsTab = "staff" | "rooms" | "procedures" | "checklist" | "clinic";
export type DashboardDetail = "hidden" | "rooms" | "active" | "done" | "grafts";
export type CaseStatus = "scheduled" | "in-progress" | "completed";
export type ProcedureRoomStatus = "available" | "occupied" | "completed";
export type Phase = "registration" | "preOp" | "anaesthesia" | "extraction" | "placing" | "dressing" | "postOp";

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

export interface ProcedurePhaseTime {
  start: string;
  end: string;
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
  record: CaseRecord;
}

export interface ProcedureQueueItem {
  patient: Omit<Patient, "medications">;
  procedure: string;
  notes: string;
  addedAt: string;
}

export interface ProcedureRoom {
  patient: Omit<Patient, "medications">;
  assignee: string;
  procedure: string;
  notes: string;
  status: ProcedureRoomStatus;
  queue: ProcedureQueueItem[];
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
}

export interface HistoryResponse {
  sessions: LoadedSession[];
}

export interface AppState {
  curUser: User | null;
  currentTab: AppTab;
  selectedCase: string;
  selectedRosterTab: RosterTab;
  dashboardDetail: DashboardDetail;
  cfgTab: SettingsTab;
  roomModalOpen: boolean;
  saveTimer: number | null;
  loading: boolean;
  saving: boolean;
  saveStatus: "idle" | "dirty" | "saving" | "saved" | "error";
  saveError: string;
  historyRows: LoadedSession[];
  historyDetailDate: string;
  historyLoadedAt: number;
  historyLoading: boolean;
  liveOpenCases: Record<string, boolean>;
  cc: number;
  sessionDate: string;
  leadName: string;
  C: Record<string, CaseRecord>;
  PR: Record<string, ProcedureRoom>;
  cfg: AppConfig;
}

export type StatusView = ["done" | "active" | "scheduled", string];
