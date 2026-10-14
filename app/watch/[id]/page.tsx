import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { getRoomState } from "@/lib/watch";
import WatchRoom from "./WatchRoom";

export const dynamic = "force-dynamic";

/** A synchronized "date room": the pre-generated date plays on one shared clock, with live reactions,
 * chat and audience polls. The audience reacts and predicts; it never steers the characters. */
export default async function WatchRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const state = await getRoomState(await getDb(), id, viewerId);
  if (!state) notFound();
  return <WatchRoom initial={state} />;
}
