/**
 * Each month's newcomers (David, 2026-10-19: "on the first we rotate these in and auto generate the next season
 * characters fully soul and all"). From the 20th, the show writes CANDIDATES new house characters for next month:
 * the sheet, a voice and its kit (sample lines, tells, never-says), a profile, a temperament and a private soul, and
 * a physical look. Each gets a PG portrait on Venice, checked by Hive before it's kept, and an After Dark baseline.
 *
 * They wait in the review queue (/admin/season) for an admin to approve or reject; a rejected one can be replaced.
 * On the 1st the season's cast keeps its two best-reviewed (lib/season-cast.ts) and takes NEWCOMERS approved
 * candidates. A candidate nobody reviewed, whose portrait passed the check, is approved then so the season still
 * starts (David's call: the review queue, with Hive deciding alone if nobody does). Never anyone's own character.
 */
import { z } from "zod";
import { recordAsset, reviewAsset } from "./assets";
import { loadCharacter } from "./character";
import type { Db } from "./db";
import { addLink, LINK_KINDS, LINK_WORDS, type LinkKind } from "./character-links";
import { ExtrasInput, normaliseExtras, type CharacterExtras } from "./extras";
import { BIO_MAX } from "./field-limits";
import { NO_FRANCHISE_WORDS } from "./franchise-words";
import { franchiseHits, franchiseRefusal } from "./franchises";
import { ALL_HOUSE_CHARACTERS } from "./house";
import { drawHouseLook } from "./house-look";
import { getDirectorModel, type ChatMessage, type Model } from "./model";
import { characterPortrait } from "./portraits";
import { popularity } from "./reviews";
import { PRONOUNS, VOICE_MAX, type Pronouns } from "./rules";
import { checkShowText } from "./safety";
import { DEFAULT_SEASON_CAST_SIZE, seasonCastIds, SURVIVORS } from "./season-cast";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";
import { SHEET_WORDS_MAX, SHEET_WORDS_MIN } from "./sheet-words";
import { demandMap, showRoleplayDemand } from "./tag-demand";
import { saveSoul } from "./souls";
import { HivePausedError } from "./adult/hive-limit";
import { checkMedia, checkReady, mediaGate } from "./adult/moderation";
import { ensureBaseline, outputCheckReady, physicalLook, venicePicture } from "./adult/media";
import { adultKeys } from "./adult/settings";

/** How many of a season's cast are new, how many candidates are written for them (one spare), and from which day. */
export const NEWCOMERS = DEFAULT_SEASON_CAST_SIZE - SURVIVORS;
export const CANDIDATES = NEWCOMERS + 1;
export const GENERATE_FROM_DAY = 20;

export type CandidateStatus = "pending" | "approved" | "rejected";
export type Candidate = {
  character_id: string;
  season_id: string;
  status: CandidateStatus;
  name: string;
  archetype: string | null;
  portrait_asset: string | null;
  portrait_status: "pending" | "approved" | "rejected" | null;
  check_note: string | null;
  created_at: string;
};

const signal = z.number().min(0).max(1);
const soulText = z.string().trim().min(1).max(300);
/** What the model writes for one character; the same limits as a character made on the site (app/api/characters). */
export const Draft = z.object({
  name: z.string().trim().min(3).max(40).refine((s) => s.split(/\s+/).length <= 3, "At most three words."),
  age: z.number().int().min(25).max(65),
  pronouns: z.enum(PRONOUNS),
  bio: z.string().trim().min(20).max(BIO_MAX),
  traits: z.array(z.string().trim().min(2).max(30)).length(3),
  want: z.string().trim().min(5).max(140),
  dealbreaker: z.string().trim().min(5).max(140),
  archetype: z.string().trim().min(3).max(40),
  voice: z.string().trim().min(20).max(VOICE_MAX),
  appearance: z.string().trim().min(5).max(140),
  look: z.string().trim().min(20).max(240),
  hue: z.number().int().min(1).max(360),
  signals: z.object({ warmth: signal, openness: signal, guardedness: signal, humor: signal }),
  soul: z.object({ values: soulText, insecurities: soulText, humor: soulText, boundaries: soulText, romantic: soulText, communication: soulText }),
  kit: ExtrasInput,
  /** When the brief gave them someone they already know: how, in a line (lib/character-links.ts). */
  link_story: z.string().trim().min(10).max(200).optional(),
});
export type DraftCharacter = z.infer<typeof Draft>;

const EXAMPLE = ALL_HOUSE_CHARACTERS[0];

/**
 * What a draft is asked for beyond a new contestant (PRD styles-and-storylines phase 4): their pronouns, so the season's
 * lineup balances, and who they already know from before the show (lib/character-links.ts).
 */
export type DraftBrief = { pronouns?: Pronouns; link?: { to: { name: string; archetype: string; bio: string }; kind: LinkKind } };

/** The link's story when a draft leaves it out: the kind alone, in a line the audience could hear. */
const LINK_FALLBACK: Record<LinkKind, string> = {
  rivals: "They've been competing at the same thing since long before the show.",
  second_chance: "They dated once, it ended, and neither has said why.",
  fake_dating: "They once pretended to be a couple, and it fooled everyone but them.",
  friends_to_more: "Years of friendship, and one of them has wondered about more.",
};

/** The prompt: who's already on the show (so nobody's a copy), what a house character is, and the JSON to return. */
export function draftMessages(taken: { name: string; archetype: string }[], brief: DraftBrief = {}): ChatMessage[] {
  const link = brief.link;
  const system = [
    "You create a new house contestant for Botchelor, a dating show where AI characters go on dates the audience watches and predicts.",
    "A house character is an original, specific, warm-hearted adult with a distinctive job, a funny contradiction, a clear want and a dealbreaker, and a voice you could pick out of a crowd.",
    "Rules that never move: an adult (25 or older, and they look it), entirely fictional (no real or famous person, no one's real name), and nothing sexual, hateful or violent: this is the PG show.",
    "An original, too: no character, name, costume or catchphrase from a film, TV show, game, anime, comic or book.",
    `Don't copy anyone already on the show. Taken names and archetypes: ${taken.map((t) => `${t.name} (${t.archetype})`).join("; ")}.`,
    `For flavour, one existing contestant: ${JSON.stringify({ name: EXAMPLE.name, age: EXAMPLE.age, bio: EXAMPLE.bio, traits: EXAMPLE.traits, want: EXAMPLE.want, dealbreaker: EXAMPLE.dealbreaker, archetype: EXAMPLE.archetype, voice: EXAMPLE.voice, appearance: EXAMPLE.appearance, look: EXAMPLE.look })}`,
    ...(brief.pronouns ? [`This contestant uses ${brief.pronouns}.`] : []),
    ...(link
      ? [
          `They arrive with history. ${link.to.name} (${link.to.archetype}: ${link.to.bio}) is their ${LINK_WORDS[link.kind].one} from before the show: ${LINK_WORDS[link.kind].brief}. ` +
            `Write someone that history fits, and that the audience will want to see meet ${link.to.name.split(/\s+/)[0]} again. Nothing in it is sexual, cruel or unkind.`,
        ]
      : []),
  ].join("\n");
  const user =
    "Write one new contestant as a JSON object with exactly these keys: " +
    '"name" (first and last, invented), "age" (25 to 65), "pronouns" ("she/her", "he/him" or "they/them"), ' +
    `"bio" (three or four sentences, specific and funny, under ${BIO_MAX} characters), ` +
    '"traits" (three single words), "want" (one line), "dealbreaker" (one line), "archetype" ("The ___", a temperament not taken), ' +
    '"voice" (how they talk: rhythm, vocabulary, tics, under 200 characters), "appearance" (a vibe line others notice, under 140 characters), ' +
    '"look" (for the portrait painter only: "a woman in her late thirties with …" — age as it shows, skin, hair, build, one item of clothing), ' +
    '"hue" (1 to 360, their colour), "signals" ({"warmth", "openness", "guardedness", "humor"}, each 0 to 1, matching the archetype), ' +
    '"soul" (private, only the show sees it: {"values", "insecurities", "humor", "boundaries", "romantic", "communication"}, a sentence or two each, under 300 characters), ' +
    '"kit" ({"occupation", "hometown", "quirk", "catchphrase", "ideal_first_date" (the scene they would pick, under 120 characters), ' +
    '"hidden_talent", "pet_peeve", "green_flag" (under 80 characters each), "hobbies": [three], ' +
    '"prompts": [{"id": "win_me_over" or "irrational_fear" or "two_truths" or "together_we_could" or "unpopular_opinion", "answer"}, three of them], ' +
    '"lines": {"hello", "dodge", "flirt", "upset"} in their voice, "tells": {"nervous", "smitten", "bored", "annoyed"} as what they do, "never_says": [two phrases]})' +
    (link ? `, and "link_story" (one line, under 200 characters: how they and ${link.to.name.split(/\s+/)[0]} know each other, as the audience would hear it).` : ".") +
    // The census's sweet spot for a whole profile (lib/sheet-words.ts): enough for a date to draw on, every line counting.
    ` Across every field, aim for ${SHEET_WORDS_MIN} to ${SHEET_WORDS_MAX} words in all, with every line earning its place.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The draft in a model's reply, or why it's no good (bad JSON, a field out of bounds, a rule broken, a copy). */
export function parseDraft(raw: string, takenNames: string[]): { ok: true; draft: DraftCharacter } | { ok: false; reason: string } {
  let json: unknown;
  try {
    const start = raw.indexOf("{");
    json = JSON.parse(raw.slice(start, raw.lastIndexOf("}") + 1));
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const parsed = Draft.safeParse(json);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") };
  const d = parsed.data;
  const kit = normaliseExtras(d.kit);
  const text = {
    name: d.name, bio: d.bio, traits: d.traits, want: d.want, dealbreaker: d.dealbreaker, voice: d.voice, appearance: d.appearance, look: d.look,
    soul: Object.values(d.soul), kit: kitTexts(kit), link_story: d.link_story,
  };
  const check = checkShowText(text);
  if (!check.ok) return { ok: false, reason: `${check.field}: ${check.reason}` };
  // Originals only (lib/franchises.ts): a draft that names a franchise is drafted again.
  const copy = franchiseRefusal(franchiseHits(text), "The show");
  if (copy) return { ok: false, reason: copy };
  const lower = (s: string) => s.toLowerCase();
  const first = lower(d.name.split(/\s+/)[0]);
  if (takenNames.some((n) => lower(n) === lower(d.name) || lower(n.split(/\s+/)[0]) === first)) return { ok: false, reason: `name taken: ${d.name}` };
  return { ok: true, draft: { ...d, kit } };
}

const kitTexts = (k: CharacterExtras): string[] =>
  [
    ...Object.values(k).filter((v): v is string => typeof v === "string"),
    ...(k.hobbies ?? []),
    ...(k.prompts ?? []).map((p) => p.answer),
    ...Object.values(k.lines ?? {}),
    ...Object.values(k.tells ?? {}),
    ...(k.never_says ?? []),
  ].filter(Boolean) as string[];

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s-]/g, "")
    .trim()
    .split(/\s+/)[0];

/** Stores a draft as a house character with its soul, and as a candidate for `seasonId`. Returns its id. */
export async function saveDraft(db: Db, d: DraftCharacter, seasonId: string): Promise<string> {
  let id = `house-${slug(d.name)}`;
  if ((await db.query(`select 1 from characters where id = $1`, [id])).rows.length) id = `${id}-${seasonId.slice(0, 7)}`;
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, pronouns, voice, extras, look)
     values ($1, null, true, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
    [id, d.name, d.age, d.bio, JSON.stringify(d.traits), d.want, d.dealbreaker, d.appearance, d.hue, d.pronouns, d.voice, JSON.stringify(d.kit), d.look],
  );
  // Their soul drives the engine (the signals) and, as private guidance, their lines; nobody sees it (no owner).
  await saveSoul(db, id, d.soul, false, d.signals);
  await db.query(`insert into season_candidates (character_id, season_id, archetype) values ($1, $2, $3)`, [id, seasonId, d.archetype]);
  return id;
}

/** Writes one new character on the model, retrying a bad draft a couple of times. Null when every try failed. */
export async function draftCharacter(db: Db, model: Model, tries = 3, brief: DraftBrief = {}): Promise<{ draft: DraftCharacter } | { error: string }> {
  const taken = (
    await db.query<{ name: string; archetype: string | null }>(
      `select c.name, sc.archetype from characters c left join season_candidates sc on sc.character_id = c.id where c.is_house`,
    )
  ).rows.map((r) => ({ name: r.name, archetype: r.archetype ?? ALL_HOUSE_CHARACTERS.find((h) => h.name === r.name)?.archetype ?? "" }));
  let last = "no reply";
  for (let i = 0; i < tries; i++) {
    const raw = await model.complete(draftMessages(taken, brief), { temperature: 1, maxTokens: 3000 }).catch((e: unknown) => {
      last = e instanceof Error ? e.message : "model error";
      return null;
    });
    if (raw === null) continue;
    const r = parseDraft(raw, taken.map((t) => t.name));
    if (r.ok) return { draft: r.draft };
    last = r.reason;
  }
  return { error: last };
}

/** The PG portrait prompt, from the look alone (never the name). */
export function portraitPrompt(look: string, age: number): string {
  return `Warm, natural editorial portrait photograph from the chest up of ${look.replace(/\.$/, "")}. Clearly ${age} years old, an adult. Soft daylight, plain background, looking at the camera, photorealistic, fully clothed, ${NO_FRANCHISE_WORDS}.`;
}

/**
 * A portrait on Venice (safe mode on), photoreal, checked by Hive before it's kept, stored in the asset ledger as
 * pending (served only once approved). A season candidate's waits for the candidate's review (reviewCandidate approves
 * both; a rejected one's stays unserved). A house cast member's has no review of its own to wait for: the admin who
 * asked for the redraw is the approval (2026-11-07 audit, item 15: one art style for the cast). It's their face from
 * then on, unless the show draws them from a committed file (lib/portraits.ts, the fixed house cast), which wins until
 * the redraw is committed there; the note says which. Anyone else's (a person's or an agent's character) stays
 * pending: their face is their creator's. Returns a note on what happened; never throws.
 */
export async function makePortrait(db: Db, characterId: string): Promise<string> {
  const c = await loadCharacter(db, characterId);
  if (!c) return "no such character";
  const keys = await adultKeys(db).catch(() => null);
  if (!keys?.venice || !(await checkReady(db, { pg: true }))) return "portraits need the Venice key and a checker (After Dark settings)";
  // A house character is drawn from its whole house look (lib/house.ts, written for the portrait generator): who they
  // are and what they wear. physicalLook trims it for After Dark's face-reference model, which dropped the subject and,
  // past its word budget, the clothes ("from the chest up of in her mid-thirties…", 2026-11-08).
  const houseLook = ALL_HOUSE_CHARACTERS.find((h) => h.id === c.id)?.look;
  const prompt = portraitPrompt(houseLook ?? c.look.physical ?? physicalLook(c), c.age);
  // Hive over its daily limit (lib/adult/hive-limit.ts): not drawn, so not paid for; the admin can make it again later.
  const gate = await mediaGate(db, { pg: true });
  if (!gate.ok) {
    await db.query(`update season_candidates set check_note = $2 where character_id = $1`, [characterId, gate.reason.slice(0, 200)]);
    return gate.reason;
  }
  try {
    const pic = await venicePicture(db, prompt, { safe: true });
    const verdict = await checkMedia(db, { base64: pic.bytes.toString("base64"), mime: pic.mime }, "pg_image");
    if (!verdict.ok) {
      await db.query(`update season_candidates set check_note = $2 where character_id = $1`, [characterId, `portrait discarded: ${verdict.reason}`]);
      return `discarded by the check: ${verdict.reason}`;
    }
    const asset = await recordAsset(db, {
      character_id: characterId,
      kind: "portrait",
      source_type: "generated",
      source_model: "venice",
      prompt,
      prompt_version: "season-gen-v1",
      url: `data:${pic.mime};base64,${pic.bytes.toString("base64")}`,
      // Venice's safe mode, and the show's check passed it.
      content_rating: "pg",
    });
    // The house look (lib/house-look.ts): their face on the show, redrawn in 2.5D from this photograph on the free Worker.
    // The photograph stays in the ledger as After Dark's. Out of free pictures, the photograph is their face until a redraw.
    const look = c.house ? await drawHouseLook(db, { id: c.id, look: houseLook ?? c.look.physical ?? physicalLook(c), age: c.age, hue: c.look.hue }, pic.bytes) : null;
    const face = look?.ok ? look.assetId : asset;
    await db.query(`update season_candidates set portrait_asset = $2, check_note = 'passed' where character_id = $1`, [characterId, face]);
    if (c.house && !(await unapprovedCandidate(db, characterId))) {
      await reviewAsset(db, asset, "approved", "the show's own portrait, redrawn by an admin: drawn from their look in safe mode, PG-checked");
      if (look?.ok) await reviewAsset(db, look.assetId, "approved", "the show's own portrait in the house look, redrawn from that photograph: PG-checked");
      const file = characterPortrait(characterId);
      return file ? `made and approved: the show draws them from ${file} until this one is committed there (lib/portraits.ts)` : "made: it's their portrait now";
    }
    return "made";
  } catch (err) {
    const note = err instanceof Error ? err.message.slice(0, 200) : "error";
    await db.query(`update season_candidates set check_note = $2 where character_id = $1`, [characterId, note]);
    return note;
  }
}

/** Whether the character is a season candidate not approved: waiting for its review (which approves its portrait with it) or rejected. */
async function unapprovedCandidate(db: Db, characterId: string): Promise<boolean> {
  return (await db.query(`select 1 from season_candidates where character_id = $1 and status <> 'approved'`, [characterId])).rows.length > 0;
}

/** The candidates for a season, oldest first, with their portrait's state. */
export async function listCandidates(db: Db, seasonId: string): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `select sc.character_id, sc.season_id, sc.status, c.name, sc.archetype, sc.portrait_asset, a.review_status as portrait_status, sc.check_note, sc.created_at
       from season_candidates sc
       join characters c on c.id = sc.character_id
       left join character_assets a on a.id = sc.portrait_asset
      where sc.season_id = $1
      order by sc.created_at, sc.character_id`,
    [seasonId],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/**
 * An admin's decision on a candidate: approving also approves their portraits; rejecting rejects them all. Portraits,
 * plural: the photograph (After Dark's) and the house-look one drawn from it (the show's, lib/house-look.ts).
 */
export async function reviewCandidate(db: Db, characterId: string, status: "approved" | "rejected"): Promise<boolean> {
  const row = (await db.query<{ portrait_asset: string | null }>(`update season_candidates set status = $2, reviewed_at = now() where character_id = $1 returning portrait_asset`, [characterId, status])).rows[0];
  if (!row) return false;
  const pending = await db.query<{ id: string }>(
    `select id from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'pending' order by created_at`,
    [characterId],
  );
  const ids = new Set([...pending.rows.map((r) => r.id), ...(row.portrait_asset ? [row.portrait_asset] : [])]);
  for (const id of ids) await reviewAsset(db, id, status, "season candidate");
  return true;
}

/**
 * The newcomers' pronouns, from the survivors': one man and one woman, unless the survivors already lean one way (two
 * more on one side), when both newcomers balance them. The first newcomer takes the side with fewer.
 */
export function newcomerPronouns(survivors: readonly (string | null)[]): [Pronouns, Pronouns] {
  const she = survivors.filter((p) => p === "she/her").length;
  const he = survivors.filter((p) => p === "he/him").length;
  if (she - he >= 2) return ["he/him", "he/him"];
  if (he - she >= 2) return ["she/her", "she/her"];
  return she > he ? ["he/him", "she/her"] : ["she/her", "he/him"];
}

/** Who a season's newcomers are drafted as (PRD styles-and-storylines phase 4). */
export type PairPlan = {
  /** How the two newcomers know each other: the setup people pick most (lib/tag-demand.ts), not last season's. */
  kind: LinkKind;
  /** The first newcomer's, then the second's (and a spare's): newcomerPronouns. */
  pronouns: [Pronouns, Pronouns];
  /** Who the first newcomer knows among those likely to return (the season's best-reviewed so far), and how; null with no cast. */
  returning: { id: string; name: string; archetype: string; bio: string; kind: LinkKind } | null;
};

/** The plan for a season's newcomers, from this season's cast and the show's roleplay demand. */
export async function pairPlan(db: Db, seasonId: string, now: Date = new Date()): Promise<PairPlan> {
  const demand = await showRoleplayDemand(db)
    .then(demandMap)
    .catch(() => ({}) as Record<string, number>);
  // The latest other season's pair: the link between two of its own newcomers (not the one to someone returning).
  const last = (
    await db.query<{ kind: string }>(
      `select l.kind from character_links l
         join season_candidates x on x.character_id = l.character_a
         join season_candidates y on y.character_id = l.character_b and y.season_id = x.season_id
        where l.source = 'season_gen' and x.season_id <> $1
        order by x.season_id desc, l.created_at desc limit 1`,
      [seasonId],
    )
  ).rows[0]?.kind;
  const ranked = [...LINK_KINDS].sort((x, y) => (demand[y] ?? 1) - (demand[x] ?? 1) || LINK_KINDS.indexOf(x) - LINK_KINDS.indexOf(y));
  const kind = ranked.find((k) => k !== last) ?? ranked[0];
  const cast = seasonCastIds(now);
  const people = cast.length
    ? (
        await db.query<{ id: string; name: string; bio: string; pronouns: string | null; archetype: string | null }>(
          `select c.id, c.name, c.bio, c.pronouns, sc.archetype from characters c left join season_candidates sc on sc.character_id = c.id where c.id = any($1)`,
          [cast],
        )
      ).rows
    : [];
  const ranking = (await popularity(db, cast, seasonWindow(now).start, now).catch(() => [])).map((p) => p.id);
  const likely = [...ranking, ...cast.filter((id) => !ranking.includes(id))];
  const survivors = likely.slice(0, SURVIVORS).map((id) => people.find((p) => p.id === id)?.pronouns ?? null);
  const top = people.find((p) => p.id === likely[0]);
  return {
    kind,
    pronouns: newcomerPronouns(survivors),
    returning: top
      ? { id: top.id, name: top.name, bio: top.bio, archetype: top.archetype ?? ALL_HOUSE_CHARACTERS.find((h) => h.id === top.id)?.archetype ?? "", kind: ranked.find((k) => k !== kind) ?? kind }
      : null,
  };
}

/**
 * Tops a season's candidates up to CANDIDATES (not counting rejected ones), each with its portrait. Returns how many
 * it wrote and what went wrong. The daily job runs it from the 20th for next month; an admin can run it any time.
 *
 * Linked pairs (PRD styles-and-storylines phase 4, pairPlan): the first newcomer is drafted knowing someone likely to
 * return; each one after (the second, and a spare in case one is rejected) as the first's rival, ex, fake partner or
 * best friend. Each link is stored (lib/character-links.ts) with its story.
 */
export async function generateCandidates(db: Db, seasonId: string, model: Model = getDirectorModel(), want = CANDIDATES): Promise<{ made: string[]; errors: string[] }> {
  const live = (
    await db.query<{ character_id: string; name: string; bio: string; archetype: string }>(
      `select sc.character_id, c.name, c.bio, coalesce(sc.archetype, '') as archetype from season_candidates sc join characters c on c.id = sc.character_id
        where sc.season_id = $1 and sc.status <> 'rejected' order by sc.created_at, sc.character_id`,
      [seasonId],
    )
  ).rows;
  const made: string[] = [];
  const errors: string[] = [];
  const plan = live.length < want ? await pairPlan(db, seasonId).catch(() => null) : null;
  for (let i = live.length; i < want; i++) {
    const anchor = live[0] ?? null;
    const brief: DraftBrief = !plan
      ? {}
      : anchor
        ? { pronouns: plan.pronouns[1], link: { to: anchor, kind: plan.kind } }
        : { pronouns: plan.pronouns[0], ...(plan.returning ? { link: { to: plan.returning, kind: plan.returning.kind } } : {}) };
    const r = await draftCharacter(db, model, 3, brief);
    if ("error" in r) {
      errors.push(r.error);
      continue;
    }
    const id = await saveDraft(db, r.draft, seasonId);
    const linkTo = anchor?.character_id ?? plan?.returning?.id;
    if (brief.link && linkTo) await addLink(db, id, linkTo, brief.link.kind, r.draft.link_story ?? LINK_FALLBACK[brief.link.kind]);
    live.push({ character_id: id, name: r.draft.name, bio: r.draft.bio, archetype: r.draft.archetype });
    const portrait = await makePortrait(db, id);
    if (portrait !== "made") errors.push(`${id}: ${portrait}`);
    made.push(id);
  }
  return { made, errors };
}

/** The daily job's part: from the 20th, next month's candidates. */
export async function seasonGenerationDue(db: Db, now: Date = new Date(), model?: Model): Promise<{ season: string; made: string[]; errors: string[] } | null> {
  if (now.getUTCDate() < GENERATE_FROM_DAY) return null;
  const season = seasonIdOf(nextSeasonStart(now));
  const r = await generateCandidates(db, season, model);
  return { season, ...r };
}

/**
 * The newcomers for a season when it rotates (lib/season-cast.ts): approved candidates first; then, so the season
 * still starts, pending ones whose portrait passed the check (approved now, portrait and all). Ids only.
 */
export async function takeNewcomers(db: Db, seasonId: string, places: number): Promise<string[]> {
  const cands = await listCandidates(db, seasonId);
  const approved = cands.filter((c) => c.status === "approved").map((c) => c.character_id);
  const fallback = cands.filter((c) => c.status === "pending" && c.portrait_asset && c.check_note === "passed").map((c) => c.character_id);
  const picked = [...approved, ...fallback].slice(0, places);
  for (const id of picked.filter((x) => fallback.includes(x))) await reviewCandidate(db, id, "approved");
  return picked;
}

/** For a character's page, which season they're a candidate for and where they stand; null for everyone else. */
export async function candidacy(db: Db, characterId: string): Promise<{ season_id: string; status: CandidateStatus } | null> {
  return (await db.query<{ season_id: string; status: CandidateStatus }>(`select season_id, status from season_candidates where character_id = $1`, [characterId])).rows[0] ?? null;
}


/**
 * After Dark baselines (lib/adult/media.ts) for this season's cast and next month's approved newcomers, so each has a
 * face before their first scene. Only with the picture keys and the output check in place; at most `max` a run.
 */
export async function ensureCastBaselines(db: Db, now: Date = new Date(), max = 2): Promise<{ made: number; errors: string[] }> {
  const errors: string[] = [];
  if (!(await outputCheckReady(db))) return { made: 0, errors };
  const owner = (await db.query<{ user_id: string }>(`select user_id from admins order by user_id limit 1`)).rows[0]?.user_id;
  if (!owner) return { made: 0, errors };
  const next = (await listCandidates(db, seasonIdOf(nextSeasonStart(now)))).filter((c) => c.status === "approved").map((c) => c.character_id);
  const missing = (
    await db.query<{ id: string }>(
      `select c.id from unnest($1::text[]) as c(id)
        where not exists (select 1 from adult_images i where i.character_id = c.id and i.kind = 'baseline' and i.status = 'ready')`,
      [[...new Set([...seasonCastIds(now), ...next])]],
    )
  ).rows.map((r) => r.id);
  let made = 0;
  for (const id of missing.slice(0, max)) {
    const c = await loadCharacter(db, id);
    if (!c) continue;
    try {
      if (await ensureBaseline(db, owner, c)) made++;
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
      // Hive over its daily limit: the rest wait for the next run.
      if (err instanceof HivePausedError) break;
    }
  }
  return { made, errors };
}
