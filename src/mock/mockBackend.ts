/**
 * In-browser stand-in for the `dsa-api` Edge Function, used only when
 * VITE_MOCK_API=1 (local UI work and regression tests). It mirrors the real
 * function's semantics: session upsert, per-case/room upsert of only the rows
 * sent, rows never deleted, config written whole, history summary shape.
 */
import type { User } from "@supabase/supabase-js";
import { AuthError, NetworkError } from "../api";

type Row = Record<string, unknown>;
interface Db {
  sessions: Record<string, { id: string; room_count: number; lead: string; config: Row }>;
  cases: Record<string, Record<string, Row>>;
  rooms: Record<string, Record<string, Row>>;
}

const DB_KEY = "msk_mock_db";
const USER_KEY = "msk_mock_user";
const OFFLINE_KEY = "msk_mock_offline";
const PASSWORD = "test1234";

function db(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* ignore */
  }
  return { sessions: {}, cases: {}, rooms: {} };
}

function write(next: Db): void {
  localStorage.setItem(DB_KEY, JSON.stringify(next));
}

function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function wait(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function user(email: string): User {
  return { id: `mock-${email}`, email, user_metadata: { full_name: email.split("@")[0].replace(/\b\w/g, (c) => c.toUpperCase()) } } as unknown as User;
}

export async function mockSignIn(email: string, password: string): Promise<User> {
  await wait();
  if (!email || password !== PASSWORD) throw new Error("Invalid login credentials");
  localStorage.setItem(USER_KEY, email);
  return user(email);
}

export async function mockSignOut(): Promise<void> {
  localStorage.removeItem(USER_KEY);
}

export async function mockSessionUser(): Promise<User | null> {
  const email = localStorage.getItem(USER_KEY);
  return email ? user(email) : null;
}

function ensureSession(d: Db, date: string, seed: Row = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be in YYYY-MM-DD format");
  if (!d.sessions[date]) {
    d.sessions[date] = { id: `sess-${date}`, room_count: Number(seed.cc ?? 4), lead: String(seed.lead ?? ""), config: obj(seed.cfg) };
  }
  return d.sessions[date];
}

function load(d: Db, date: string): Row {
  const s = ensureSession(d, date);
  const C: Row = {};
  for (const [key, row] of Object.entries(d.cases[date] || {})) C[key] = row;
  const PR: Row = {};
  for (const [key, row] of Object.entries(d.rooms[date] || {})) PR[key] = row;
  return { id: s.id, date, cc: s.room_count, lead: s.lead, cfg: s.config, C, PR };
}

export async function mockRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  await wait();
  if (localStorage.getItem(OFFLINE_KEY) === "1") throw new NetworkError("Can't reach the server. Changes are kept on this device and will sync when the connection returns.");
  if (!localStorage.getItem(USER_KEY)) throw new AuthError("You are not signed in.");
  const url = new URL(path, "http://mock");
  const method = (options.method || "GET").toUpperCase();
  const d = db();

  if (method === "GET" && url.pathname === "/sessions") {
    const res = load(d, url.searchParams.get("date") || "");
    write(d);
    return res as T;
  }

  if (method === "POST" && url.pathname === "/sessions") {
    const body = obj(JSON.parse(String(options.body || "{}")));
    const date = String(body.date || "");
    const cc = Number(body.cc ?? 4);
    if (!Number.isInteger(cc) || cc < 1 || cc > 99) throw new Error("room count must be an integer between 1 and 99");
    const s = ensureSession(d, date, body);
    s.room_count = cc;
    s.lead = String(body.lead ?? "");
    s.config = obj(body.cfg);
    d.cases[date] = d.cases[date] || {};
    for (const [key, value] of Object.entries(obj(body.C))) {
      if (!/^case[0-9]+$/.test(key)) continue;
      const c = obj(value);
      d.cases[date][key] = {
        patient: obj(c.patient),
        assessment: obj(c.assessment),
        preOp: obj(c.preOp),
        procedure: obj(c.procedure),
        postOp: obj(c.postOp),
        teams: obj(c.teams),
        startTime: String(c.startTime ?? ""),
        endTime: String(c.endTime ?? ""),
        status: String(c.status ?? "scheduled"),
      };
    }
    d.rooms[date] = d.rooms[date] || {};
    for (const [key, value] of Object.entries(obj(body.PR))) {
      if (!/^pr[0-9]+$/.test(key)) continue;
      const r = obj(value);
      d.rooms[date][key] = {
        patient: obj(r.patient),
        assignee: String(r.assignee ?? ""),
        procedure: String(r.procedure ?? ""),
        notes: String(r.notes ?? ""),
        status: String(r.status ?? "available"),
        queue: Array.isArray(r.queue) ? r.queue : [],
      };
    }
    write(d);
    return load(d, date) as T;
  }

  if (method === "GET" && url.pathname === "/history") {
    const date = url.searchParams.get("date");
    if (date) {
      const res = { session: load(d, date) };
      write(d);
      return res as T;
    }
    const sessions = Object.keys(d.sessions)
      .sort()
      .reverse()
      .slice(0, 40)
      .map((sd) => {
        const s = d.sessions[sd];
        const C: Row = {};
        for (const [key, row] of Object.entries(d.cases[sd] || {})) {
          // The real history list omits teams/preOp/postOp for live rows.
          C[key] = { patient: row.patient, assessment: row.assessment, preOp: {}, procedure: row.procedure, postOp: {}, teams: {}, startTime: "", endTime: "", status: row.status };
        }
        const PR: Row = {};
        for (const [key, row] of Object.entries(d.rooms[sd] || {})) {
          PR[key] = { patient: row.patient, assignee: "", procedure: row.procedure, notes: "", status: row.status, queue: row.queue };
        }
        return { id: s.id, date: sd, cc: s.room_count, lead: s.lead, cfg: s.config, C, PR };
      });
    return { sessions } as T;
  }

  throw new Error("Route not found");
}
