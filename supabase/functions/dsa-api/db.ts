import { createClient } from "./deps.ts";
import { serviceRoleKey, supabaseUrl } from "./env.ts";

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
