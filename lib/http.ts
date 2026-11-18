import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string, public upstreamStatus?: number) { super(message); }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, `Configure ${name} in .env before using this endpoint.`);
  return value;
}

export async function jsonBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "Use Content-Type: application/json.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 131_072) throw new ApiError(413, "Request body must be under 128 KB.");
  try { return JSON.parse(text); }
  catch { throw new ApiError(400, "Request body must be valid JSON."); }
}

export async function endpoint(action: () => Promise<unknown>, status = 200) {
  try { return Response.json(await action(), { status, headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    console.error("API request failed:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

export async function providerRequest(provider: string, url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ApiError(502, `${provider} could not be reached or timed out. Check the provider dashboard before retrying; creation may have succeeded.`); }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      const reason = body.message || body.error?.message || body.error || body.detail || body;
      detail = typeof reason === "string" ? reason : JSON.stringify(reason);
      // Providers may echo credentials and request URLs in validation errors.
      for (const [key, value] of Object.entries(process.env)) {
        if (/KEY|SECRET|TOKEN/.test(key) && value) detail = detail.replaceAll(value, "[redacted]");
      }
      detail = detail.replace(/https?:\/\/[^\s"<>]+/g, "[provider URL]").replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted token]").replace(/[\r\n\t]+/g, " ").slice(0, 600);
    } catch { /* Use the status fallback if the response is not JSON. */ }
    const advice = provider === "Tavus" && response.status === 402
      ? "Check available conversational minutes and billing in Tavus."
      : "Check credentials, IDs, quota, and account permissions.";
    throw new ApiError(502, `${provider} returned HTTP ${response.status}. ${detail || advice}`, response.status);
  }
  if (response.status === 204) return null;
  try { const text = await response.text(); return text ? JSON.parse(text) : null; }
  catch { throw new ApiError(502, `${provider} returned an invalid JSON response.`); }
}
