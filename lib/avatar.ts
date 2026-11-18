import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, providerRequest, requiredEnv } from "./http";
import { wakePhrases } from "./wake-words";

export const tavusId = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/, "Use a Tavus resource ID.");
export const agentSchema = z.object({
  bot_name: z.string().trim().min(1).max(100).default("Alex"),
  system_prompt: z.string().trim().min(1).max(16000).optional(),
  wake_words_enabled: z.boolean().default(true),
});
const roomSchema = z.object({
  conversation_id: tavusId,
  conversation_url: z.url().max(1500).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".daily.co") && !url.username && !url.password;
  }),
});

async function tavus(path: string, method = "GET", body?: unknown) {
  return providerRequest("Tavus", `https://tavusapi.com/v2/${path}`, {
    method, headers: { "x-api-key": requiredEnv("TAVUS_API_KEY"), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function removeCallPal(id: string) {
  if (id === process.env.TAVUS_PAL_ID?.trim()) return;
  try {
    const path = `pals/${tavusId.parse(id)}`;
    const pal = await tavus(path);
    if (!pal.pal_name?.startsWith("Call/")) throw new ApiError(400, "Refusing to delete a shared PAL.");
    await tavus(path, "DELETE");
  } catch (error) {
    if (!(error instanceof ApiError && error.upstreamStatus === 404)) throw error;
  }
}
export async function endConversation(id: string, palId?: string) {
  try { await tavus(`conversations/${tavusId.parse(id)}/end`, "POST"); }
  catch (error) { if (!(error instanceof ApiError && error.upstreamStatus === 404)) throw error; }
  if (palId) await removeCallPal(palId);
}
export async function prepareAvatar(input: z.infer<typeof agentSchema>) {
  const duration = z.coerce.number().int().min(60).max(3600).safeParse(process.env.TAVUS_MAX_CALL_DURATION || 600);
  if (!duration.success) throw new ApiError(503, "TAVUS_MAX_CALL_DURATION must be between 60 and 3600 seconds, within your Tavus plan limit.");
  let palId = process.env.TAVUS_PAL_ID?.trim();
  let temporaryPalId: string | undefined;
  if (palId) {
    if (!tavusId.safeParse(palId).success) throw new ApiError(503, "TAVUS_PAL_ID must be a valid Tavus PAL ID.");
  } else {
    const faceId = tavusId.safeParse(requiredEnv("TAVUS_FACE_ID"));
    if (!faceId.success) throw new ApiError(503, "TAVUS_FACE_ID must be a valid Tavus face ID.");
    if (!input.system_prompt) throw new ApiError(400, "A system prompt is required when TAVUS_PAL_ID is empty.");
    const pal = await tavus("pals", "POST", {
      pal_name: `Call/${randomUUID()}`, pipeline_mode: "full", system_prompt: input.system_prompt, default_face_id: faceId.data,
      layers: { conversational_flow: input.wake_words_enabled ? wakePhrases(input.bot_name) : { wake_phrase: null, sleep_phrase: null } },
    });
    const id = tavusId.safeParse(pal?.pal_id);
    if (!id.success) throw new ApiError(502, "Tavus returned an invalid PAL ID. Check its dashboard before retrying.");
    palId = temporaryPalId = id.data;
  }
  let data;
  try {
    data = await tavus("conversations", "POST", {
      pal_id: palId, conversation_name: input.bot_name, require_auth: false, max_participants: 2,
      properties: { max_call_duration: duration.data, participant_absent_timeout: 300, participant_left_timeout: 15 },
    });
  } catch (error) {
    // Retain the PAL on timeouts/5xx: the conversation may have been created.
    if (temporaryPalId && error instanceof ApiError && error.upstreamStatus && error.upstreamStatus < 500) await removeCallPal(temporaryPalId).catch(() => undefined);
    throw error;
  }
  const room = roomSchema.safeParse(data);
  if (!room.success) {
    if (tavusId.safeParse(data?.conversation_id).success) await endConversation(data.conversation_id, temporaryPalId).catch(() => undefined);
    throw new ApiError(502, "Tavus returned an invalid conversation. Check its dashboard before retrying.");
  }
  return { ...room.data, temporary_pal_id: temporaryPalId };
}
