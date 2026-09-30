import { allowedOrigin } from "./env.ts";

const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

function allowedOriginList(): string[] {
  const fromEnv = allowedOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const merged = new Set([...fromEnv, ...DEFAULT_LOCAL_ORIGINS]);
  return [...merged];
}

function resolveOrigin(req?: Request): string {
  const list = allowedOriginList();
  if (list.includes("*")) return "*";

  const requestOrigin = req?.headers.get("Origin")?.trim() ?? "";
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;

  // Local Vite may use any port; allow loopback http origins explicitly.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) {
    return requestOrigin;
  }

  // Allow private LAN hosts used by `vite --host 0.0.0.0` (e.g. http://10.x.x.x:5173).
  if (
    /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      requestOrigin,
    )
  ) {
    return requestOrigin;
  }

  // Allow this project's Vercel production + preview URLs
  // e.g. msk-duty-roaster-beta.vercel.app, msk-duty-roaster-1apzckr69-....vercel.app
  if (/^https:\/\/msk-duty-roaster([a-z0-9-]+)?\.vercel\.app$/i.test(requestOrigin)) {
    return requestOrigin;
  }

  return list[0] || "*";
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    Vary: "Origin",
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

export function apiError(message: string, status = 400, details?: unknown, req?: Request): Response {
  return json({ error: message, details }, status, req);
}
