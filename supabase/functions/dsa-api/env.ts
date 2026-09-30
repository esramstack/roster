declare const Deno: {
  env: { get(name: string): string | undefined };
};

export const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
export const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const allowedOrigin = Deno.env.get("DSA_ALLOWED_ORIGIN") ?? "*";

export function hasRequiredEnv(): boolean {
  return Boolean(supabaseUrl && serviceRoleKey);
}
