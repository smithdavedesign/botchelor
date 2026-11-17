/**
 * Stories (lib/narration.ts tellStory; David, 2026-11-17, "Read as story"): a finished show date or an After Dark
 * chapter told again as prose, from start to end, made once and kept (the stories table).
 *
 * - A show date's story is the date's: one for everyone who can see its lines (lib/game.ts getEpisodeView decides who),
 *   written on the show's narrator and held to the show's checks. Reading one that exists is free. Making it is for the
 *   date's own people (an owner of one of its two characters), the Companion Plan's members and admins: included with
 *   the plan, else STORY_TOKENS bought dates, given back if it doesn't come (lib/writing-style.ts).
 * - An After Dark chapter's is its viewer's: written on the fast writer, held to After Dark's checks and their own hard
 *   nos. It comes with the subscription and counts one scene step, like any other step (the caller says whether it's
 *   open: After Dark's "narrated" rollout switch).
 * WRITING_STYLES=0 stops new stories everywhere; kept ones still read.
 */
import { randomUUID } from "node:crypto";
import { refundBoughtTokens, spendBoughtTokens } from "./allowance";
import type { Db } from "./db";
import { getEpisodeView } from "./game";
import type { Model, Usage } from "./model";
import { tellStory, type NarrateLine, type Story } from "./narration";
import { shortName } from "./names";
import { venueName } from "./venues";
import { showNarrator, turnToNarrate } from "./narrate-date";
import { summarizeUsage } from "./pricing";
import { hasDepth, storyPrice, stylesAudience } from "./writing-style";

export type StoredStory = Story & { created_at: string };
export type StoryAnswer = { ok: true; story: StoredStory; made: boolean } | { ok: false; status: number; error: string; message: string };

const no = (status: number, error: string, message: string): StoryAnswer => ({ ok: false, status, error, message });

/** A kept story, or null. `owner` null: a show date's (everyone's). */
export async function storyFor(db: Db, kind: "episode" | "adult", ref: string, owner: string | null): Promise<StoredStory | null> {
  const r = (
    await db.query<{ title: string; paragraphs: string[]; created_at: Date | string }>(
      `select title, paragraphs, created_at from stories where kind = $1 and ref_id = $2 and coalesce(owner_id, '') = coalesce($3, '')`,
      [kind, ref, owner],
    )
  ).rows[0];
  return r ? { title: r.title, paragraphs: r.paragraphs, created_at: new Date(r.created_at).toISOString() } : null;
}

async function keep(db: Db, kind: "episode" | "adult", ref: string, owner: string | null, story: Story, model: string | null, cost: number | null): Promise<StoredStory> {
  // Two people asking at once: the first one kept wins, and the other reads it.
  await db.query(
    `insert into stories (id, kind, ref_id, owner_id, title, paragraphs, model, cost) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     on conflict (kind, ref_id, coalesce(owner_id, '')) do nothing`,
    [randomUUID(), kind, ref, owner, story.title, JSON.stringify(story.paragraphs), model, cost],
  );
  return (await storyFor(db, kind, ref, owner))!;
}

const WHY: Record<"held" | "empty" | "failed", string> = {
  held: "The story didn't pass our checks this time. Try again.",
  empty: "The story came back empty. Try again.",
  failed: "The writer is busy right now. Try again in a moment.",
};

/** Whether `viewer` may make a show date's story: one of its own people, a member of the plan, or an admin. */
export async function canMakeStory(db: Db, viewer: string | null | undefined, isCreator: boolean): Promise<boolean> {
  if (!viewer || stylesAudience() === "off") return false;
  return isCreator || (await hasDepth(db, viewer));
}

/**
 * A show date's story for `viewer`: the kept one (anyone who can see the date's lines), or made now when they may
 * (canMakeStory) and it's paid for. The date must be one whose lines they can see, finished.
 */
export async function episodeStory(db: Db, episodeId: string, viewer: string, opts: { make: boolean; model?: Model } = { make: false }): Promise<StoryAnswer> {
  const view = await getEpisodeView(db, episodeId, viewer);
  if (!view || view.hidden) return no(404, "not_found", "Not found.");
  const lines = view.status === "ready" ? (view.transcript ?? []) : [];
  // The story tells the whole date, so it's only for someone who already gets the lines (never a spectator before it airs).
  if (!lines.length) return no(view.status === "ready" ? 404 : 409, view.status === "ready" ? "not_found" : "not_ready", "The date's lines aren't out yet: its story comes once they are.");
  const kept = await storyFor(db, "episode", episodeId, null);
  if (kept) return { ok: true, story: kept, made: false };
  if (!opts.make) return no(404, "no_story", "No story of this date yet.");
  if (!(await canMakeStory(db, viewer, view.is_creator))) return no(403, "not_yours", "A date's story is made by one of its own people, or with the Companion Plan.");
  const price = await storyPrice(db, viewer);
  if (price && !(await spendBoughtTokens(db, viewer, price))) {
    return no(402, "needs_tokens", `A story costs ${price} bought date${price === 1 ? "" : "s"}, or comes with the Companion Plan.`);
  }
  const [a, b] = view.characters;
  const names = { a: shortName(a.name), b: shortName(b.name) };
  const used: Usage[] = [];
  const told = await tellStory(
    opts.model ?? showNarrator(),
    {
      rating: "pg",
      people: [{ name: names.a }, { name: names.b }],
      place: view.venue ? safeVenue(view.venue) : null,
      context: view.setting || null,
      lines: lines.map((t) => turnToNarrate(t, names)),
    },
    { onUsage: (u) => void used.push(u) },
  );
  if (!told.ok) {
    if (price) await refundBoughtTokens(db, viewer, price);
    return no(told.why === "failed" ? 503 : 422, `story_${told.why}`, WHY[told.why]);
  }
  const u = summarizeUsage(used, 1);
  return { ok: true, story: await keep(db, "episode", episodeId, null, told.story, u.models[0] ?? null, u.cost_usd), made: true };
}

function safeVenue(v: string): string {
  try {
    return venueName(v);
  } catch {
    return v;
  }
}

/**
 * An After Dark chapter's story for its viewer. `lines` are the chapter's (the caller reads them from the viewer's own
 * night); `ref` names it. `open`: whether stories are open to them (lib/adult/narrate-scene.ts adultNarratedOpen).
 * `charge` takes the scene step (null: taken; else the sentence why not); `giveBack` returns it when the story didn't come.
 */
export async function adultStory(
  db: Db,
  viewer: string,
  input: { ref: string; names: { a: string; b: string }; place: string | null; context: string | null; lines: readonly NarrateLine[]; extra?: (t: string) => string | null },
  deps: { model: Model; charge: (n: number) => Promise<string | null>; giveBack: (n: number) => Promise<void>; make: boolean; open: boolean },
): Promise<StoryAnswer> {
  if (!deps.open) return no(404, "not_found", "Not found.");
  const kept = await storyFor(db, "adult", input.ref, viewer);
  if (kept) return { ok: true, story: kept, made: false };
  if (!deps.make) return no(404, "no_story", "No story of this chapter yet.");
  if (!input.lines.length) return no(409, "empty", "Nothing written in this chapter yet.");
  // One scene step, like any other step of the night (the caller counts it, and never for an admin's cap).
  const weight = 1;
  const refused = await deps.charge(weight);
  if (refused) return no(429, "capped", refused);
  const used: Usage[] = [];
  const told = await tellStory(
    deps.model,
    {
      rating: "adult",
      people: [{ name: shortName(input.names.a) }, { name: shortName(input.names.b) }],
      place: input.place,
      context: input.context,
      lines: input.lines,
      ...(input.extra ? { extra: input.extra } : {}),
    },
    { onUsage: (u) => void used.push(u) },
  );
  if (!told.ok) {
    await deps.giveBack(weight);
    return no(told.why === "failed" ? 503 : 422, `story_${told.why}`, WHY[told.why]);
  }
  const u = summarizeUsage(used, 1);
  const cost = used.reduce((s, x) => s + (x.cost ?? 0), 0) || u.cost_usd;
  return { ok: true, story: await keep(db, "adult", input.ref, viewer, told.story, u.models[0] ?? null, cost), made: true };
}

