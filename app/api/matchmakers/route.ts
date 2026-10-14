import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session, userIdFromRequest } from "@/lib/http";
import { listMyProposals } from "@/lib/mechanics";

const id = z.string().min(1).max(64);
const Input = z
  .object({ character_a: id, character_b: id })
  .refine((v) => v.character_a !== v.character_b, { message: "Propose two different characters.", path: ["character_b"] });

/**
 * Matchmakers (PRD "Further ideas"): a spectator proposes a pairing of two cast members and earns points
 * if a later date between them ends in a second date. One proposal per spectator per unordered pair.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_proposal");
  const db = await getDb();

  const found = (
    await db.query<{ n: number }>("select count(*)::int as n from characters where id in ($1, $2)", [
      input.character_a,
      input.character_b,
    ])
  ).rows[0].n;
  if (found < 2) return json({ error: "character_not_found" }, 404, sess);

  const proposalId = crypto.randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `insert into matchmaker_proposals (id, proposer_id, character_a, character_b)
     values ($1, $2, $3, $4)
     on conflict (proposer_id, least(character_a, character_b), greatest(character_a, character_b)) do nothing
     returning id`,
    [proposalId, sess.userId, input.character_a, input.character_b],
  );
  // New proposal → 201; a repeat of a pair already proposed → 200, no duplicate stored.
  return json({ proposed: true, new: rows.length > 0 }, rows.length ? 201 : 200, sess);
});

/** The caller's proposals, newest first, each marked whether it has paid off yet. */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ proposals: [] });
  return json({ proposals: await listMyProposals(await getDb(), userId) });
});
