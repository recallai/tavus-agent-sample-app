export async function readApiJson(response: Response, endpoint: string) {
  const label = `${endpoint} returned HTTP ${response.status}`;
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`${label} with invalid JSON. Check the local server and tunnel.`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${label} with an invalid API response.`);
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : label);
  return data;
}

// Daily sometimes reports a plain object instead of an Error.
export function avatarErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    for (const key of ["errorMsg", "message", "error"] as const) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "Avatar connection failed. Launch a new bot from the app.";
}
