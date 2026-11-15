import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { listAuditions, reviewAudition } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { ensureSeasonCast, leadOverride, setLeadOverride } from "@/lib/season-cast";
import { ceremonySummary, houseOf } from "@/lib/ceremony";
import { castingLead, openCasting } from "@/lib/casting";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { SEASON_FORMAT_SLUGS, SEASON_FORMATS, seasonFormat } from "@/lib/season-format";
import { seasonFormatSlug, setSeasonFormat } from "@/lib/season-format-store";
import { stageRecouplingNight } from "@/lib/recoupling";
import { generateCandidates, GENERATE_FROM_DAY, listCandidates, makePortrait, reviewCandidate } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";
import { seasonBallotTally } from "@/lib/season-vote";

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
  const [thisFormat, nextFormat, auditions, tally, thisLead, nextLead, thisHouse, ceremonies, casting] = await Promise.all([
    seasonFormatSlug(db, thisId),
    seasonFormatSlug(db, nextId),
    listAuditions(db, nextId),
    seasonBallotTally(db, nextId),
    leadOverride(db, thisId),
    leadOverride(db, nextId),
    houseOf(db, thisId),
    ceremonySummary(db, thisId).catch(() => null),
    castingLead(db, now).catch(() => null),
  ]);
  // The Botchelor (lib/ceremony.ts): who the lead would be, and is. The default lead is picked with the cast on the 1st
  // (the most reviewed of last season's survivors); a pick here overrides it, and until then the panel shows the pick.
  const leadNames = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[thisLead, nextLead, thisHouse.lead].filter(Boolean)])).rows.map((r) => [r.id, r.name]),
  );
  const botchelor = {
    // The house characters an admin can make the lead: the roster, by name.
    leads: HOUSE_CHARACTERS.map((c) => ({ id: c.id, name: c.name })),
    this_season: {
      runs: Boolean(seasonFormat(thisFormat).lead),
      lead: thisHouse.lead ? { id: thisHouse.lead, name: leadNames.get(thisHouse.lead) ?? thisHouse.lead } : null,
      override: thisLead,
      suitors: cast.filter((c) => c.source === "suitor").map((c) => ({ id: c.character_id, name: names.get(c.character_id) ?? c.character_id, in: thisHouse.suitors.includes(c.character_id) })),
      ceremonies: ceremonies?.ceremonies ?? [],
    },
    next_season: { runs: Boolean(seasonFormat(nextFormat).lead), override: nextLead, override_name: nextLead ? leadNames.get(nextLead) ?? nextLead : null },
    // Open casting (lib/casting.ts): who a new character's first date goes to right now, or why nobody. In the preseason it
    // opens the moment next season's format AND lead are both picked here; the OPEN_CASTING=0 switch closes it.
    casting: { switched_on: openCasting(), now: casting ? { phase: casting.phase, month: casting.month, lead: { id: casting.lead.id, name: casting.lead.name }, roses_at: casting.roses_at } : null },
  };
  return {
    this_season: { id: thisId, label: seasonLabel(thisId), format: thisFormat, cast: cast.map((c) => ({ ...c, name: names.get(c.character_id) ?? c.character_id })) },
    next_season: {
      id: nextId,
      label: seasonLabel(nextId),
      format: nextFormat,
      generate_from_day: GENERATE_FROM_DAY,
      candidates: candidates.map((c) => ({ ...c, portrait: c.portrait_asset ? portraits.get(c.portrait_asset) ?? null : null })),
      // People's characters up for the cast (lib/auditions.ts): approved ones take the open places before candidates.
      auditions,
      // The viewers' vote for next season's format (lib/season-vote.ts): the winner runs unless a format is picked here.
      ballot: SEASON_FORMATS.map((f) => ({ slug: f.slug, votes: tally.get(f.slug) ?? 0 })),
    },
    // The formats a season can run in (lib/season-format.ts): classic is the default; the island month is picked here.
    formats: SEASON_FORMATS.map((f) => ({ slug: f.slug, label: f.label, title: f.title, lead: Boolean(f.lead) })),
    botchelor,
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
  z.object({ action: z.literal("format"), season_id: z.string().min(4).max(10), slug: z.enum(SEASON_FORMAT_SLUGS) }),
  z.object({ action: z.literal("recoupling") }),
  z.object({ action: z.literal("audition"), character_id: z.string().min(1).max(80), verdict: z.enum(["approved", "rejected"]) }),
  z.object({ action: z.literal("lead"), season_id: z.string().min(4).max(10), character_id: z.string().min(1).max(80).nullable() }),
]);

/** Approve or reject a candidate or an audition, redo a portrait, write next month's candidates, or pick a season's format. */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  let note: string | null = null;
  if (input.action === "approve" || input.action === "reject") {
    if (!(await reviewCandidate(db, input.character_id, input.action === "approve" ? "approved" : "rejected"))) return json({ error: "not_found", message: "No such candidate." }, 404);
  } else if (input.action === "audition") {
    if (!(await reviewAudition(db, input.character_id, input.verdict))) return json({ error: "not_found", message: "No such audition." }, 404);
  } else if (input.action === "format") {
    // Only the running season or the next can change: a closed season's format is part of its record.
    const now = new Date();
    const allowed = [seasonIdOf(now), seasonIdOf(nextSeasonStart(now))];
    if (!allowed.includes(input.season_id)) return json({ error: "season_closed", message: "Only this season or the next can change format." }, 400);
    await setSeasonFormat(db, input.season_id, input.slug);
    note = `${seasonLabel(input.season_id)} runs as ${SEASON_FORMATS.find((f) => f.slug === input.slug)?.label ?? input.slug}.`;
  } else if (input.action === "lead") {
    // The Botchelor's lead (lib/ceremony.ts): a house character, for this season or the next. Next season's pick takes
    // effect when its cast is chosen on the 1st; this season's is written straight into the stored cast.
    const now = new Date();
    const allowed = [seasonIdOf(now), seasonIdOf(nextSeasonStart(now))];
    if (!allowed.includes(input.season_id)) return json({ error: "season_closed", message: "Only this season or the next can change its lead." }, 400);
    if (input.character_id && !HOUSE_CHARACTERS.some((c) => c.id === input.character_id)) return json({ error: "not_house", message: "The lead is one of the house cast." }, 400);
    await setLeadOverride(db, input.season_id, input.character_id);
    if (input.character_id && input.season_id === seasonIdOf(now)) {
      await db.query(`update season_casts set character_id = $2 where season_id = $1 and source = 'lead'`, [input.season_id, input.character_id]);
      const { forgetLoadedSeasonCast } = await import("@/lib/season-cast");
      forgetLoadedSeasonCast();
    }
    note = input.character_id ? `${seasonLabel(input.season_id)}'s lead: ${HOUSE_CHARACTERS.find((c) => c.id === input.character_id)?.name}.` : `${seasonLabel(input.season_id)}'s lead is back to the default (last season's most reviewed survivor).`;
  } else if (input.action === "recoupling") {
    // Stage the recoupling night now, off-cycle (lib/recoupling.ts): the same run the season's last night gets.
    const r = await stageRecouplingNight(db);
    note = r.ran ? `The Recoupling ran: ${r.booked} booked, ${r.failed} failed — watch it at /mixers/${r.night_id}.` : `Not run: ${r.reason}.`;
  } else if (input.action === "portrait") {
    note = await makePortrait(db, input.character_id);
  } else {
    const r = await generateCandidates(db, seasonIdOf(nextSeasonStart(new Date())));
    note = `Wrote ${r.made.length}.${r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""}`;
  }
  return json({ ...(await view()), note });
});
