import { endConversation, tavusId } from "../../../../lib/avatar";
import { endpoint } from "../../../../lib/http";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const id = tavusId.parse((await context.params).id);
    const palId = new URL(request.url).searchParams.get("temporary_pal_id");
    await endConversation(id, palId ? tavusId.parse(palId) : undefined);
    return { conversation_id: id, ended: true };
  });
}
