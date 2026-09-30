import { apiError } from "./cors.ts";
import { admin } from "./db.ts";
import type { AuthResult, JsonRecord } from "./types.ts";

export async function authenticate(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { error: apiError("Missing Authorization header", 401, undefined, req) };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: apiError("Invalid or expired session", 401, error?.message, req) };
  }

  const user = data.user;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return { error: apiError("Could not load profile", 500, profileError.message, req) };
  }

  if (profile && profile.active === false) {
    return { error: apiError("User profile is inactive", 403, undefined, req) };
  }

  if (!profile) {
    const metadata = (user.user_metadata ?? {}) as JsonRecord;
    const fallbackName = String(metadata.full_name ?? user.email?.split("@")[0] ?? "Staff");
    const { data: createdProfile, error: createError } = await admin
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email,
        full_name: fallbackName,
        role: String(metadata.role ?? "Staff"),
        active: true,
      })
      .select("*")
      .single();

    if (createError) {
      return { error: apiError("Could not create profile", 500, createError.message, req) };
    }

    return { user, profile: createdProfile };
  }

  return { user, profile };
}
