/**
 * Stories (lib/narration.ts tellStory; David, 2026-11-17, "Read as story"): a finished show date or an After Dark
 * chapter told again as prose, from start to end, made once and kept (the stories table).
 *
 * - A show date's story is the date's: one for everyone who can see its lines (lib/game.ts getEpisodeView decides who),
 *   written on the show's director model and held to the show's checks. Making it costs STORY_TOKENS bought tokens.
 * - An After Dark chapter's is its viewer's: written on the fast writer, held to After Dark's checks and their own hard
 *   nos, and it counts ADULT_STORY_WRITES of the month's scene steps.
 * Admins only while it's tested (lib/writing-style.ts stylesOpen), and admins pay nothing.
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
import { ADULT_STORY_WRITES, extraFor, STORY_TOKENS, stylesOpen } from "./writing-style";

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

/**
 * A show date's story for `viewer`: the kept one, or made now when they may (stylesOpen) and can pay for it. The date
 * must be one whose lines they can see, finished.
 */
export async function episodeStory(db: Db, episodeId: string, viewer: string, opts: { make: boolean; model?: Model } = { make: false }): Promise<StoryAnswer> {
  if (!(await stylesOpen(db, viewer))) return no(404, "not_found", "Not found.");
  const view = await getEpisodeView(db, episodeId, viewer);
  if (!view || view.hidden) return no(404, "not_found", "Not found.");
  const kept = await storyFor(db, "episode", episodeId, null);
  if (kept) return { ok: true, story: kept, made: false };
  if (!opts.make) return no(404, "no_story", "No story of this date yet.");
  const lines = view.status === "ready" ? (view.transcript ?? []) : [];
  if (!lines.length) return no(409, "not_ready", "The date's lines aren't out yet: its story comes once they are.");
  const price = await extraFor(db, viewer, STORY_TOKENS);
  if (price && !(await spendBoughtTokens(db, viewer, price))) {
    return no(402, "needs_tokens", `A story costs ${price} token${price === 1 ? "" : "s"}. Get more in the shop.`);
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
 * night); `ref` names it. `charge` takes the scene steps (null: refused, with the sentence why); `giveBack` returns
 * them when the story didn't come.
 */
export async function adultStory(
  db: Db,
  viewer: string,
  input: { ref: string; names: { a: string; b: string }; place: string | null; context: string | null; lines: readonly NarrateLine[]; extra?: (t: string) => string | null },
  deps: { model: Model; charge: (n: number) => Promise<string | null>; giveBack: (n: number) => Promise<void>; make: boolean },
): Promise<StoryAnswer> {
  if (!(await stylesOpen(db, viewer))) return no(404, "not_found", "Not found.");
  const kept = await storyFor(db, "adult", input.ref, viewer);
  if (kept) return { ok: true, story: kept, made: false };
  if (!deps.make) return no(404, "no_story", "No story of this chapter yet.");
  if (!input.lines.length) return no(409, "empty", "Nothing written in this chapter yet.");
  const weight = await extraFor(db, viewer, ADULT_STORY_WRITES);
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

