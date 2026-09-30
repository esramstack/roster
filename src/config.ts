export const SUPABASE_URL = "https://kpjynehmvmapyywjhyqj.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwanluZWhtdm1hcHl5d2poeXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMzY4MDAsImV4cCI6MjA5OTYxMjgwMH0.vdz--1bXRmvPawEeCxIswQnO2MxLN5AobcC4rr-AkbA";

/** In Vite dev, go through same-origin proxy to avoid LAN-IP CORS failures. */
export const EDGE_FUNCTION_URL = import.meta.env.DEV
  ? "/api/dsa"
  : `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/dsa-api`;
