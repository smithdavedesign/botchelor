import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { invitePath, LEAGUE_NAME_MAX } from "@/lib/leagues";
import { assertSafeName, nameText, requireProfileName } from "@/lib/people";

const LeagueInput = z.object({ name: nameText(LEAGUE_NAME_MAX) });

/** Starts a friends' league. Its unguessable id is the invite link; the creator is the first member. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(LeagueInput, await readJson(req), "invalid_league");
  assertSafeName(input.name);
  const db = await getDb();
  await requireProfileName(db, sess.userId);

  const id = crypto.randomUUID();
  // One statement, so a league never exists without its first member.
  await db.query(
    `with league as (insert into leagues (id, name, owner_id) values ($1, $2, $3) returning id)
     insert into league_members (league_id, user_id) select id, $3 from league`,
    [id, input.name, sess.userId],
  );
  return json({ id, name: input.name, invite_path: invitePath(id) }, 201, sess);
});
