import { getDb } from "@/lib/db";
import { afterResponse, botContext, handleInteraction, type Interaction } from "@/lib/discord-bot";
import { discordBotConfig, verifyDiscordRequest } from "@/lib/discord-interactions";

// The /date bot's work after its answer (draft, save, book, wait for the cameras, reveal) runs in after(), inside the
// fifteen minutes an interaction token lasts (lib/discord-bot.ts WORK_BUDGET_MS).
export const maxDuration = 300;

/** An interaction is a few kilobytes; anything far bigger isn't Discord's. */
const MAX_BODY = 64 * 1024;

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

/**
 * Discord's interactions endpoint for the /date bot (lib/discord-bot.ts; docs/discord.md "The /date bot"). 404 unless
 * DISCORD_APP_ID and DISCORD_PUBLIC_KEY are set, and always on After Dark's host. 401 for any request whose Ed25519
 * signature doesn't check out against DISCORD_PUBLIC_KEY (Discord sends such requests on purpose, to test the endpoint).
 * The body is read once, raw, because the signature covers its exact bytes.
 */
export async function POST(req: Request): Promise<Response> {
  const config = discordBotConfig();
  if (!config) return notFound();
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const ok = await verifyDiscordRequest(config.publicKey, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), raw);
  if (!ok) return Response.json({ error: "invalid_signature" }, { status: 401 });
  let interaction: Interaction;
  try {
    interaction = JSON.parse(raw) as Interaction;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!interaction || typeof interaction.type !== "number" || typeof interaction.token !== "string") return Response.json({ error: "invalid_request" }, { status: 400 });
  // Signed with this app's key, so it is this app's; an application_id that says otherwise is refused anyway.
  if (interaction.application_id && interaction.application_id !== config.appId) return Response.json({ error: "invalid_request" }, { status: 400 });
  const handled = await handleInteraction(botContext(await getDb(), config.appId), interaction);
  if (handled.work) afterResponse(handled.work);
  return Response.json(handled.response);
}
