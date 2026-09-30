import { createClient, type User } from "@supabase/supabase-js";
import { EDGE_FUNCTION_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("No user returned from Supabase.");
  return data.user;
}

export async function signOut(): Promise<void> {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

export async function getSessionUser(): Promise<User | null> {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new Error("You are not signed in.");

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      throw new Error(
        "Could not reach the API. Use http://localhost:5173 (not a network IP), check your connection, then try again.",
      );
    }
    throw error instanceof Error ? error : new Error(message || "Network request failed");
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    await supabaseClient.auth.signOut();
    throw new Error(body.error || "Your session expired. Please sign in again.");
  }
  if (!res.ok) throw new Error(body.error || "Backend request failed");
  return body as T;
}
