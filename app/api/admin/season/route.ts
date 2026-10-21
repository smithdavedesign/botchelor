import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { ensureSeasonCast } from "@/lib/season-cast";
import { generateCandidates, GENERATE_FROM_DAY, listCandidates, makePortrait, reviewCandidate } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";

export const dynamic = "force-dynamic";
// Writing a candidate is a model call, a Venice picture and a Hive check; three of them can take a while.
export const maxDuration = 300;

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** The season now (its cast and where each came from) and next month's candidates, each with its portrait to judge. */
async function view() {
  const db = await getDb();
  const now = new Date();
  const thisId = seasonIdOf(now);
  const nextId = seasonIdOf(nextSeasonStart(now));
  const cast = await ensureSeasonCast(db, now);
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [cast.map((c) => c.character_id)])).rows.map((r) => [r.id, r.name]),
  );
  const candidates = await listCandidates(db, nextId);
  const portraits = new Map(
    (await db.query<{ id: string; url: string | null }>(`select id, url from character_assets where id = any($1)`, [candidates.map((c) => c.portrait_asset).filter(Boolean)])).rows.map((r) => [r.id, r.url]),
  );
  return {
    this_season: { id: thisId, label: seasonLabel(thisId), cast: cast.map((c) => ({ ...c, name: names.get(c.character_id) ?? c.character_id })) },
    next_season: {
      id: nextId,
      label: seasonLabel(nextId),
      generate_from_day: GENERATE_FROM_DAY,
      candidates: candidates.map((c) => ({ ...c, portrait: c.portrait_asset ? portraits.get(c.portrait_asset) ?? null : null })),
    },
  };
}

export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await view());
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), character_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal("reject"), character_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal("portrait"), character_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal("generate") }),
]);

/** Approve or reject a candidate, redo one's portrait, or write next month's candidates now (tops up to three). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  let note: string | null = null;
  if (input.action === "approve" || input.action === "reject") {
    if (!(await reviewCandidate(db, input.character_id, input.action === "approve" ? "approved" : "rejected"))) return json({ error: "not_found", message: "No such candidate." }, 404);
  } else if (input.action === "portrait") {
    note = await makePortrait(db, input.character_id);
  } else {
    const r = await generateCandidates(db, seasonIdOf(nextSeasonStart(new Date())));
    note = `Wrote ${r.made.length}.${r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""}`;
  }
  return json({ ...(await view()), note });
});
