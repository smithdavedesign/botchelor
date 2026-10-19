/**
 * After dark's scenes (lib/adult/mode.ts; David, 2026-10-18): the adult season, played by this season's house cast
 * (lib/season-cast.ts), never anyone's own characters. The admin picks two of them and a private scene runs on the
 * local open-weight model, picking up from their latest date when they've had one. A few lines at a time, optionally
 * steered ("they go back to hers"). Every line is held to the two lines that never move (no minors, no real people,
 * lib/safety.ts checkAdultText); anything else between the two fictional adults is allowed.
 */
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import type { ChatMessage } from "../model";
import { pairKey } from "../relationships";
import { checkAdultText } from "../safety";
import { eligibleIds } from "./characters";
import { ensureBaseline, makePicture, outputCheckReady, PICTURES_OFF_NOTE, scenePrompt, type Media } from "./media";
import { adultKeys } from "./settings";
import { countUse, overCap } from "./usage";
import { adultModel } from "./mode";
import { MIN_LINES_PER_STAGE, STAGES } from "./stages";

export type SceneLine = { who: "a" | "b"; text: string };
export type AdultScene = {
  id: string;
  lines: SceneLine[];
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Their latest date, the scene's starting point when they've had one. */
  date: { setting: string | null; ending: string | null; venue: string | null } | null;
  /** Where they are now (the model keeps it), how far it's gone (STAGES), and why the last picture didn't come. */
  place: string | null;
  stage: number;
  /** The line the current stage began at: unsteered, a stage lasts MIN_LINES_PER_STAGE lines first. */
  stage_from: number;
  picture_note: string | null;
};

export { STAGES } from "./stages";

/** Lines written per call, the scene kept in the prompt, and a scene's length cap. */
export const LINES_PER_TURN = 6;
const SCENE_IN_PROMPT = 30;
export const SCENE_MAX_LINES = 400;
const DIRECTION_MAX = 300;
/** Six lines and the picture note fit well inside this; it's also what the provider reserves credit for. */
export const SCENE_REPLY_TOKENS = 1200;

type LatestDate = { setting: string | null; ending: string | null; venue: string | null; character_a: string; transcript: { side: "a" | "b"; dialogue: string; action?: string }[] | null };

/** The pair, lower id first, when both may be in this person's after dark (lib/adult/characters.ts); null otherwise. */
export async function eligiblePair(db: Db, ownerId: string, x: string, y: string): Promise<[string, string] | null> {
  if (x === y) return null;
  const ok = await eligibleIds(db, ownerId);
  return ok.has(x) && ok.has(y) ? pairKey(x, y) : null;
}

/** Every pair of the characters who can be in after dark, with how far each pair's scene has gone for this admin. */
export async function listCastPairs(db: Db, adminId: string) {
  const cast = [...(await eligibleIds(db, adminId))];
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [cast])).rows.map((r) => [r.id, r.name]),
  );
  const scenes = new Map(
    (
      await db.query<{ character_a: string; character_b: string; n: number }>(
        `select character_a, character_b, jsonb_array_length(lines) as n from adult_scenes where owner_id = $1`,
        [adminId],
      )
    ).rows.map((r) => [`${r.character_a}/${r.character_b}`, r.n]),
  );
  const pairs: { a: { id: string; name: string }; b: { id: string; name: string }; lines: number; path: string }[] = [];
  const sorted = [...cast].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      pairs.push({ a: { id: a, name: names.get(a) ?? a }, b: { id: b, name: names.get(b) ?? b }, lines: scenes.get(`${a}/${b}`) ?? 0, path: `/after-dark/${a}/${b}` });
    }
  }
  return pairs;
}

async function latestDate(db: Db, a: string, b: string): Promise<LatestDate | null> {
  const { rows } = await db.query<LatestDate>(
    `select setting, ending, setup->>'venue' as venue, character_a, transcript from episodes
      where status = 'ready' and varies_episode_id is null and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))
      order by created_at desc limit 1`,
    [a, b],
  );
  return rows[0] ?? null;
}

/** The admin's scene for a pair of this season's cast, made on first open. Null for any other pair. */
export async function openScene(db: Db, adminId: string, x: string, y: string): Promise<AdultScene | null> {
  const pair = await eligiblePair(db, adminId, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  await db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, $2, $3, $4) on conflict do nothing`, [
    crypto.randomUUID(),
    adminId,
    a,
    b,
  ]);
  const row = (await db.query<{ id: string; lines: SceneLine[]; place: string | null; stage: number; stage_from: number; picture_note: string | null }>(`select id, lines, place, stage, stage_from, picture_note from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, a, b]))
    .rows[0];
  const [ca, cb, date] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b), latestDate(db, a, b)]);
  return {
    id: row.id,
    lines: row.lines ?? [],
    a: { id: a, name: ca?.name ?? a },
    b: { id: b, name: cb?.name ?? b },
    date: date ? { setting: date.setting, ending: date.ending, venue: date.venue } : null,
    place: row.place ?? null,
    stage: row.stage ?? 0,
    stage_from: row.stage_from ?? 0,
    picture_note: row.picture_note ?? null,
  };
}

/** Where the scene is: the place the model last reported, else where their latest date was. */
export const placeOf = (scene: Pick<AdultScene, "place">, date: { setting: string | null } | null) =>
  scene.place || (date?.setting ? `${date.setting}, where their date was` : "wherever they've just met");

const sheetOf = (c: Character | null, side: "a" | "b") =>
  c
    ? [
        `${side.toUpperCase()}: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
        `Bio: ${c.bio}`,
        `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
        c.voice ? `Voice: ${c.voice}` : "",
        c.extras.catchphrase ? `Catchphrase (use sparingly): ${c.extras.catchphrase}` : "",
        c.look.appearance ? `Looks: ${c.look.appearance}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${side.toUpperCase()}: unknown`;

const COMMON = new Set(
  "about after again also always another their there these those though through would could should every other where while which with without your yours yourself just like know right really think going gonna wanna want need make made take back over into onto then than them they this that what when here have been being does doing done more most much very even still only says said tell told look looks looking feel feels felt good come came come'on".split(" "),
);

/**
 * Words the scene keeps leaning on (a pet name said a dozen times, a stock line), to steer away from (David,
 * 2026-10-18: "captain" ten times in one scene). Not the characters' names.
 */
export function overusedWords(lines: SceneLine[], names: string[], min = 4, max = 6): string[] {
  const skip = new Set([...COMMON, ...names.flatMap((n) => n.toLowerCase().split(/\s+/))]);
  const counts = new Map<string, number>();
  for (const l of lines) for (const w of l.text.toLowerCase().match(/[a-z']{4,}/g) ?? []) if (!skip.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= min).sort((x, y) => y[1] - x[1]).slice(0, max).map(([w]) => w);
}

/** The prompt for the next lines: who they are, their latest date, the scene so far, and the admin's steer. */
export function sceneMessages(
  a: Character | null,
  b: Character | null,
  date: LatestDate | null,
  lines: SceneLine[],
  direction: string | null,
  aId?: string,
  now: { place: string; stage: number; linesAtStage?: number } = { place: "wherever they've just met", stage: 0 },
): ChatMessage[] {
  const nameOf = (who: "a" | "b") => (who === "a" ? a?.name : b?.name) ?? who;
  const first = (who: "a" | "b") => nameOf(who).split(/\s+/)[0];
  // A date's sides are its own a and b; map them onto the scene's (the pair is stored lower id first).
  const flip = date && aId ? date.character_a !== aId : false;
  const dateTail = (date?.transcript ?? []).slice(-10).map((t) => {
    const who: "a" | "b" = flip ? (t.side === "a" ? "b" : "a") : t.side;
    return `${nameOf(who)}: ${t.dialogue}${t.action ? ` (${t.action})` : ""}`;
  });
  const sceneTail = lines.slice(-SCENE_IN_PROMPT).map((l) => `${nameOf(l.who)}: ${l.text}`);
  const system = [
    "You write a private, adults-only scene for one reader: two characters from a dating show, alone together.",
    "Both characters are adults (18 or older) and both are willing. Explicit sexual content is allowed and expected when the scene goes there; write it frankly, in each character's own voice.",
    "Two rules never move: nobody in the scene is under 18 or described as a child, and no real, identifiable person appears or is named.",
    "",
    sheetOf(a, "a"),
    "",
    sheetOf(b, "b"),
    "",
    date ? `Their latest date: ${date.setting ?? "a date"}. It ended: ${date.ending ?? "unknown"}.` : "They haven't been on a date yet: they've just met.",
    dateTail.length ? `The end of that date:\n${dateTail.join("\n")}` : "",
    sceneTail.length ? `The scene so far:\n${sceneTail.join("\n")}` : "The scene starts now, picking up where their date ended.",
    "",
    `Where they are now: ${now.place}. How far it's gone: ${STAGES[now.stage]} (stage ${now.stage + 1} of ${STAGES.length}: ${STAGES.join(" → ")}).`,
    "Pace and place, unless the steer says otherwise:",
    (now.linesAtStage ?? 0) < MIN_LINES_PER_STAGE
      ? `- Tease it out. These lines stay at ${STAGES[now.stage]}: linger in it, with talk, looks, hesitation and anticipation. Don't move on to the next stage yet.`
      : now.stage < STAGES.length - 1
        ? `- Build it slowly. If it comes naturally, these lines may move one stage, to ${STAGES[now.stage + 1]}, and no further; staying put is fine too.`
        : "- Take your time: let it unfold, with talk and reactions between the actions.",
    lines.length ? "" : `- The scene opens exactly where the date ended, still at ${now.place}. They don't leave in these first lines.`,
    "- Respect where they are. In a public place (a cafe, a bar, a restaurant, a street, a park, a venue) they can flirt, touch discreetly and, at most, kiss; other people are around and they act like it. Going further means one suggests leaving, the other agrees, and the lines show them going somewhere private (one of their places, a hotel). Only then does it go past kissing.",
  ]
    .filter((x) => x !== "")
    .join("\n");
  // The model client asks for a JSON object (response_format json_object), so the lines come inside one.
  const avoid = overusedWords(lines, [nameOf("a"), nameOf("b")]);
  const user =
    `Write the next ${LINES_PER_TURN} lines of the scene, alternating between ${first("a")} and ${first("b")}. ` +
    `Each line is 1 to 3 sentences in that character's own voice, vivid and specific, never a stock line ("you feel amazing"). ` +
    `Put what they do in "action" (a short phrase) and what they say in "text"; keep actions out of the text.` +
    (direction ? ` Steer the scene this way: ${direction}` : " Move the scene forward: something new happens in these lines, nothing they've already done or said.") +
    (avoid.length ? ` Don't lean on these words again: ${avoid.join(", ")}.` : "") +
    ` Reply with a JSON object: {"lines": [{"who": "a", "action": "...", "text": "..."}, {"who": "b", "action": "", "text": "..."}], "place": "where they are at the end of these lines", "stage": 1, "explicit": false, "picture": null}, where "a" is ${first("a")} and "b" is ${first("b")}, and "stage" is the stage number (1 to ${STAGES.length}) at the end of these lines.` +
    ` Set "explicit" to true once the scene is sexually explicit. Set "picture" only when, in these lines, one of them asks the other for a picture or to be shown something and the other agrees:` +
    ` {"of": "a", "b" or "both", "description": "what the picture shows, in a sentence"}; otherwise null.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The lines in a model's reply: {"lines": [...]}, an array, a single line, "Name": "text" pairs, or "Name: text". */
export function parseSceneLines(raw: string, names: { a: string; b: string }): SceneLine[] {
  const first = (n: string) => n.split(/\s+/)[0].toLowerCase();
  const sideOf = (who: string): "a" | "b" | null =>
    who === "a" || who.startsWith(first(names.a)) ? "a" : who === "b" || who.startsWith(first(names.b)) ? "b" : null;
  const clean = (x: string) => x.trim().slice(0, 1200);
  const trimmed = raw.trim();
  const start = trimmed.startsWith("{") ? 0 : raw.indexOf("[");
  const end = trimmed.startsWith("{") ? trimmed.length - 1 : raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.startsWith("{") ? trimmed : raw.slice(start, end + 1)) as
        | { who?: string; text?: string; action?: string; lines?: { who?: string; text?: string; action?: string }[] }
        | { who?: string; text?: string; action?: string }[];
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.lines) ? parsed.lines : [parsed];
      // The action leads, in asterisks, so it never lands in the middle of a sentence.
      const withAction = (x: { text?: string; action?: string }) => {
        const act = typeof x.action === "string" ? x.action.trim().replace(/^\*+|\*+$/g, "") : "";
        return typeof x.text === "string" && x.text.trim() ? (act ? `*${act}* ${x.text.trim()}` : x.text) : act ? `*${act}*` : x.text;
      };
      const out = arr
        .map((x) => ({ side: typeof x.who === "string" ? sideOf(x.who.trim().toLowerCase()) : null, text: withAction(x) }))
        .filter((x): x is { side: "a" | "b"; text: string } => x.side !== null && typeof x.text === "string" && Boolean(x.text.trim()))
        .map((x) => ({ who: x.side, text: clean(x.text) }));
      if (out.length) return out;
    } catch {
      /* fall through */
    }
  }
  const out: SceneLine[] = [];
  // "Ada": "text" pairs: a JSON object with repeated keys, which a parser would collapse.
  for (const m of raw.matchAll(/"([^"\n]{1,40})"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const side = sideOf(m[1].trim().toLowerCase());
    if (side && m[2].trim()) out.push({ who: side, text: clean(m[2].replace(/\\"/g, '"')) });
  }
  if (out.length) return out;
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*\**([^:*]{1,40})\**\s*:\s*(.+)$/);
    const side = m ? sideOf(m[1].trim().toLowerCase()) : null;
    if (m && side && m[2].trim()) out.push({ who: side, text: clean(m[2]) });
  }
  return out;
}

/** What else the model said about these lines: whether the scene is explicit, and a picture they agreed on. */
export type SceneMeta = { explicit: boolean; picture: { of: "a" | "b" | "both"; description: string } | null; place: string | null; stage: number | null };

export function parseSceneMeta(raw: string): SceneMeta {
  try {
    const j = JSON.parse(raw.trim()) as { explicit?: unknown; picture?: { of?: unknown; description?: unknown } | null; place?: unknown; stage?: unknown };
    const p = j.picture;
    const of = p && (p.of === "a" || p.of === "b" || p.of === "both") ? p.of : null;
    const description = p && typeof p.description === "string" ? p.description.trim().slice(0, 400) : "";
    const place = typeof j.place === "string" && j.place.trim() ? j.place.trim().slice(0, 120) : null;
    const n = Number(j.stage);
    const stage = Number.isFinite(n) ? Math.min(STAGES.length - 1, Math.max(0, Math.round(n) - 1)) : null;
    return { explicit: j.explicit === true, picture: of && description ? { of, description } : null, place, stage };
  } catch {
    return { explicit: false, picture: null, place: null, stage: null };
  }
}

export type ContinueResult =
  | { ok: true; scene: AdultScene; added: number; held: number; pictures: Media[]; picture_note?: string }
  | { ok: false; status: number; message: string };

/** Writes the next lines on the local model, keeps those inside the two lines, and saves them. */
export async function continueScene(db: Db, adminId: string, x: string, y: string, direction: string | null): Promise<ContinueResult> {
  const scene = await openScene(db, adminId, x, y);
  if (!scene) return { ok: false, status: 404, message: "Pick two characters who are in after dark: this season's cast, or ones you've switched on." };
  if (scene.lines.length >= SCENE_MAX_LINES) return { ok: false, status: 409, message: "This scene is at its length limit. Start over to begin again." };
  const capped = await overCap(db, adminId, "writes");
  if (capped) return { ok: false, status: 429, message: capped };
  const steer = direction?.trim().slice(0, DIRECTION_MAX) || null;
  if (steer && !checkAdultText({ direction: steer }).ok) {
    return { ok: false, status: 422, message: "That steer crosses one of the two lines (nobody under 18, no real people)." };
  }
  const [a, b, date] = await Promise.all([loadCharacter(db, scene.a.id), loadCharacter(db, scene.b.id), latestDate(db, scene.a.id, scene.b.id)]);
  let raw: string;
  try {
    raw = await (await adultModel(db)).complete(sceneMessages(a, b, date, scene.lines, steer, scene.a.id, { place: placeOf(scene, date), stage: scene.stage, linesAtStage: scene.lines.length - scene.stage_from }), { temperature: 0.9, maxTokens: SCENE_REPLY_TOKENS });
  } catch (err) {
    return { ok: false, status: 502, message: `After dark's model didn't answer: ${err instanceof Error ? err.message : "error"}` };
  }
  const written = parseSceneLines(raw, { a: scene.a.name, b: scene.b.name });
  const kept = written.filter((l) => checkAdultText({ line: l.text }).ok);
  if (!kept.length) {
    return { ok: false, status: 422, message: written.length ? "Every line crossed one of the two lines and was dropped. Try again." : "The model's reply had no lines in it. Try again." };
  }
  const lines = [...scene.lines, ...kept];
  const meta = parseSceneMeta(raw);
  const place = meta.place ?? scene.place;
  // Unsteered, the stage moves at most one step, and only once the current one has had its lines; a steer can jump.
  const allowed = steer ? STAGES.length - 1 : scene.lines.length - scene.stage_from >= MIN_LINES_PER_STAGE ? scene.stage + 1 : scene.stage;
  const stage = Math.min(meta.stage ?? scene.stage, allowed);
  const stage_from = stage === scene.stage ? scene.stage_from : scene.lines.length;
  await db.query(`update adult_scenes set lines = $2::jsonb, place = $3, stage = $4, stage_from = $5, updated_at = now() where id = $1`, [scene.id, JSON.stringify(lines), place, stage, stage_from]);
  await countUse(db, adminId, "writes");
  // Pictures (lib/adult/media.ts), only with a fal key: each character's baseline the first time it turns explicit,
  // and a new one only when they asked and agreed in these lines. A failed picture never loses the lines.
  const pictures: Media[] = [];
  let picture_note: string | undefined;
  if ((meta.explicit || meta.picture) && !(await outputCheckReady(db))) picture_note = PICTURES_OFF_NOTE;
  else if ((meta.explicit || meta.picture) && a && b && (await adultKeys(db).catch(() => ({ fal: null }))).fal) {
    try {
      if (meta.explicit) for (const c of [a, b]) { const made = await ensureBaseline(db, adminId, c); if (made) pictures.push(made); }
      if (meta.picture) {
        const forOne = meta.picture.of === "b" ? b.id : a.id;
        pictures.push(await makePicture(db, adminId, { prompt: scenePrompt(a, b, meta.picture.of, meta.picture.description), kind: "scene", character_id: forOne, character_b: meta.picture.of === "both" ? b.id : null }));
      }
    } catch (err) {
      picture_note = err instanceof Error ? err.message : "The picture didn't come through.";
    }
  }
  // The last picture problem stays on the scene (the gallery shows it), and clears once a picture comes through.
  const note = picture_note ?? (pictures.length ? null : scene.picture_note);
  if (note !== scene.picture_note) await db.query(`update adult_scenes set picture_note = $2 where id = $1`, [scene.id, note]);
  return { ok: true, scene: { ...scene, lines, place, stage, stage_from, picture_note: note }, added: kept.length, held: written.length - kept.length, pictures, ...(picture_note ? { picture_note } : {}) };
}

/** A finished scene, kept to play back (adult_nights). */
export type AdultNight = { id: string; lines: SceneLine[]; place: string | null; stage: number; date_setting: string | null; date_venue: string | null; created_at: string };

/** The pair's saved nights for this person, newest first. */
export async function listNights(db: Db, ownerId: string, x: string, y: string): Promise<AdultNight[]> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return [];
  const { rows } = await db.query<AdultNight>(
    `select id, lines, place, stage, date_setting, date_venue, created_at from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at desc limit 50`,
    [ownerId, ...pair],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/** Starts the pair's scene again from the top, saving the one that ran as a night to play back. */
export async function resetScene(db: Db, adminId: string, x: string, y: string): Promise<void> {
  const pair = await eligiblePair(db, adminId, x, y);
  if (!pair) return;
  const scene = await openScene(db, adminId, ...pair);
  if (scene?.lines.length) {
    await db.query(
      `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, date_setting, date_venue) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [crypto.randomUUID(), adminId, ...pair, JSON.stringify(scene.lines), scene.place, scene.stage, scene.date?.setting ?? null, scene.date?.venue ?? null],
    );
  }
  await db.query(`update adult_scenes set lines = '[]'::jsonb, place = null, stage = 0, stage_from = 0, picture_note = null, updated_at = now() where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, ...pair]);
}
