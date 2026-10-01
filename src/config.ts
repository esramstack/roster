export const SUPABASE_URL = "https://ioqvezimbrdaojbwsfbf.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvcXZlemltYnJkYW9qYndzZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDY1MTQsImV4cCI6MjEwNjQyMjUxNH0.xqQu_KSeqEq4eG0jvoUBlKxdaSVCdpUA-BqdacdMVss";

/** In Vite dev, go through same-origin proxy to avoid LAN-IP CORS failures. */
export const EDGE_FUNCTION_URL = import.meta.env.DEV
  ? "/api/dsa"
  : `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/dsa-api`;
