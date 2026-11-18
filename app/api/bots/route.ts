import { z } from "zod";
import { agentSchema, endConversation, prepareAvatar } from "../../../lib/avatar";
import { ApiError, endpoint, jsonBody, providerRequest, requiredEnv } from "../../../lib/http";

const schema = agentSchema.extend({
  meeting_url: z.url().refine(value => new URL(value).protocol === "https:", "Use an HTTPS meeting URL."),
}).strict();

export async function POST(request: Request) {
  return endpoint(async () => {
    const input = schema.parse(await jsonBody(request));
    const origin = tunnelOrigin();
    const region = process.env.RECALL_REGION || "us-east-1";
    if (!["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"].includes(region)) throw new ApiError(503, "RECALL_REGION must be a supported Recall region.");
    const key = requiredEnv("RECALL_API_KEY");
    const avatar = await prepareAvatar(input);
    const fragment = new URLSearchParams({ conversation_id: avatar.conversation_id, conversation_url: avatar.conversation_url });
    if (avatar.temporary_pal_id) fragment.set("temporary_pal_id", avatar.temporary_pal_id);
    const avatarUrl = `${origin}/avatar#${fragment}`;
    let bot;
    let recallAttempted = false;
    try {
      if (avatarUrl.length > 2048) throw new ApiError(502, "The avatar startup URL exceeds 2048 characters. No Recall bot was created; Tavus cleanup was requested.");
      recallAttempted = true;
      bot = await providerRequest("Recall", `https://${region}.recall.ai/api/v1/bot/`, {
        method: "POST", headers: { Authorization: key, "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_url: input.meeting_url, bot_name: input.bot_name,
          automatic_leave: {
            everyone_left_timeout: { timeout: 2, activate_after: 1 },
            bot_detection: {
              using_participant_events: { activate_after: 120, timeout: 30 },
            },
          },
          output_media: { camera: { kind: "webpage", config: { url: avatarUrl } } },
          variant: { zoom: "web_4_core", google_meet: "web_4_core", microsoft_teams: "web_4_core", webex: "web_4_core" },
        }),
      });
      if (!bot?.id) throw new ApiError(502, "Recall returned an invalid bot response.");
    } catch (error) {
      const rejected = error instanceof ApiError && error.upstreamStatus && error.upstreamStatus >= 400 && error.upstreamStatus < 500 && error.upstreamStatus !== 408;
      if (recallAttempted && !rejected) throw new ApiError(502, `Recall bot creation could not be confirmed. Check Recall before retrying to avoid a duplicate bot. Tavus conversation ${avatar.conversation_id} was kept running.`);
      try { await endConversation(avatar.conversation_id, avatar.temporary_pal_id); }
      catch { throw new ApiError(502, `Recall bot launch failed and Tavus cleanup failed. End conversation ${avatar.conversation_id} using DELETE /api/conversations/${avatar.conversation_id}${avatar.temporary_pal_id ? `?temporary_pal_id=${avatar.temporary_pal_id}` : ""}.`); }
      throw error;
    }
    return { bot_id: bot.id };
  }, 201);
}

function tunnelOrigin() {
  let url: URL;
  try { url = new URL(process.env.NGROK_URL || ""); }
  catch { throw new ApiError(503, "Start the app with ./run.sh so its ngrok tunnel is available."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new ApiError(503, "The ngrok tunnel URL is invalid. Restart ./run.sh.");
  return url.origin;
}
