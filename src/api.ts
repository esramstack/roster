import { createClient, type User } from "@supabase/supabase-js";
import { EDGE_FUNCTION_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/** Thrown when the API could not be reached (offline, DNS, CORS). Saves retry these. */
export class NetworkError extends Error {}
/** Thrown when the Supabase session is no longer valid. */
export class AuthError extends Error {}

/**
 * Local test mode (`VITE_MOCK_API=1 npm run dev`) swaps Supabase for an
 * in-browser backend that mirrors the Edge Function. It is compiled out of
 * production builds.
 */
const MOCK = import.meta.env.VITE_MOCK_API === "1";
type MockModule = typeof import("./mock/mockBackend");
let mockModule: Promise<MockModule> | null = null;
function mock(): Promise<MockModule> {
  if (!mockModule) mockModule = import("./mock/mockBackend");
  return mockModule;
}

export const supabaseClient = MOCK ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signIn(email: string, password: string): Promise<User> {
  if (MOCK) return (await mock()).mockSignIn(email, password);
  const { data, error } = await supabaseClient!.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("No user returned from Supabase.");
  return data.user;
}

export async function signOut(): Promise<void> {
  if (MOCK) return (await mock()).mockSignOut();
  const { error } = await supabaseClient!.auth.signOut();
  if (error) throw error;
}

export async function getSessionUser(): Promise<User | null> {
  if (MOCK) return (await mock()).mockSessionUser();
  const { data, error } = await supabaseClient!.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (MOCK) return (await mock()).mockRequest<T>(path, options);
  const { data, error } = await supabaseClient!.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new AuthError("You are not signed in.");

  let res: Response;
  try {
    res = await fetch(`${EDGE_FUNCTION_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || "");
    throw new NetworkError(message && !/failed to fetch|networkerror|load failed/i.test(message) ? message : "Can't reach the server. Changes are kept on this device and will sync when the connection returns.");
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    await supabaseClient!.auth.signOut();
    throw new AuthError(body.error || "Your session expired. Please sign in again.");
  }
  if (res.status >= 500 && !body.error) throw new NetworkError("The server is temporarily unavailable.");
  if (!res.ok) throw new Error(body.error || "Backend request failed");
  return body as T;
}
