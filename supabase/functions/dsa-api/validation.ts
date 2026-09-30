import type { JsonRecord } from "./types.ts";

const CASE_STATUSES = new Set(["scheduled", "in-progress", "completed"]);
const ROOM_STATUSES = new Set(["available", "occupied", "completed"]);
const PHASES = new Set(["registration", "preOp", "anaesthesia", "extraction", "placing", "dressing", "postOp"]);
const CASE_PATCH_KEYS = new Set(["patient", "assessment", "procedure", "teams", "preOp", "pre_op", "postOp", "post_op", "startTime", "start_time", "endTime", "end_time", "status", "date"]);
const ROOM_PATCH_KEYS = new Set(["patient", "assignee", "procedure", "notes", "status", "queue", "date"]);

export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00`))) {
    throw new Error("date must be in YYYY-MM-DD format");
  }
}

export function assertRoomCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new Error("room count must be an integer between 1 and 99");
  }
}

export function assertCaseKey(value: string): void {
  if (!/^case[0-9]+$/.test(value)) throw new Error(`invalid case key: ${value}`);
}

export function assertProcedureRoomKey(value: string): void {
  if (!/^pr[0-9]+$/.test(value)) throw new Error(`invalid procedure room key: ${value}`);
}

export function assertCaseStatus(value: string): void {
  if (!CASE_STATUSES.has(value)) throw new Error(`invalid case status: ${value}`);
}

export function assertRoomStatus(value: string): void {
  if (!ROOM_STATUSES.has(value)) throw new Error(`invalid procedure room status: ${value}`);
}

export function assertProcedureShape(value: JsonRecord): void {
  const currentPhase = value.currentPhase;
  if (currentPhase !== undefined && !PHASES.has(String(currentPhase))) {
    throw new Error(`invalid procedure phase: ${String(currentPhase)}`);
  }
}

export function assertAllowedPatchKeys(patch: JsonRecord, allowed: Set<string>): void {
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`field is not patchable: ${key}`);
  }
}

export function assertCasePatchKeys(patch: JsonRecord): void {
  assertAllowedPatchKeys(patch, CASE_PATCH_KEYS);
}

export function assertRoomPatchKeys(patch: JsonRecord): void {
  assertAllowedPatchKeys(patch, ROOM_PATCH_KEYS);
}
