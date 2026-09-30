import { authenticate } from "./auth.ts";
import { patchCase } from "./cases.ts";
import { apiError, corsHeaders, json } from "./cors.ts";
import { hasRequiredEnv } from "./env.ts";
import { history } from "./history.ts";
import { patchProcedureRoom } from "./procedureRooms.ts";
import { loadSession, upsertSession } from "./sessions.ts";
import { asObject, cleanPath, readBody } from "./utils.ts";

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

function errorStatus(message: string): number {
  return /invalid|must be|required|not patchable|date/i.test(message) ? 400 : 500;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (!hasRequiredEnv()) {
    return apiError("Supabase Edge Function secrets are not configured", 500, undefined, req);
  }

  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const path = cleanPath(url.pathname);
  const parts = path.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && path === "/sessions") {
      const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
      return json(await loadSession(date, auth.user.id), 200, req);
    }

    if (req.method === "POST" && path === "/sessions") {
      return json(await upsertSession(await readBody(req), auth.user.id), 200, req);
    }

    if (req.method === "GET" && path === "/history") {
      return json(await history(auth.user.id, url.searchParams.get("date")), 200, req);
    }

    if (req.method === "PATCH" && parts[0] === "cases" && parts[1]) {
      const body = await readBody(req);
      const date = url.searchParams.get("date") ?? String(asObject(body).date ?? "");
      return json(await patchCase(parts[1], date, body, auth.user.id), 200, req);
    }

    if (req.method === "PATCH" && parts[0] === "procedure-rooms" && parts[1]) {
      const body = await readBody(req);
      const date = url.searchParams.get("date") ?? String(asObject(body).date ?? "");
      return json(await patchProcedureRoom(parts[1], date, body, auth.user.id), 200, req);
    }

    return apiError("Route not found", 404, { method: req.method, path }, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected backend error";
    return apiError(message, errorStatus(message), undefined, req);
  }
});
