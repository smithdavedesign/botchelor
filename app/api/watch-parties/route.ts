import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { listLobby } from "@/lib/watch";

/** The lobby: joinable rooms — always-on template dates first, then live and upcoming premieres. */
export const GET = handle(async () => {
  return json({ rooms: await listLobby(await getDb()) });
});
