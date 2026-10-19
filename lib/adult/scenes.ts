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
import { ensureBaseline, makePicture, scenePrompt, type Media } from "./media";
import { adultKeys } from "./settings";
import { adultModel } from "./mode";

export type SceneLine = { who: "a" | "b"; text: string };
export type AdultScene = {
  id: string;
  lines: SceneLine[];
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Their latest date, the scene's starting point when they've had one. */
  date: { setting: string | null; ending: string | null } | null;
};

/** Lines written per call, the scene kept in the prompt, and a scene's length cap. */
export const LINES_PER_TURN = 6;
const SCENE_IN_PROMPT = 30;
export const SCENE_MAX_LINES = 400;
const DIRECTION_MAX = 300;

type LatestDate = { setting: string | null; ending: string | null; character_a: string; transcript: { side: "a" | "b"; dialogue: string; action?: string }[] | null };

/** The pair, lower id first, when both may be in after dark (lib/adult/characters.ts); null otherwise. */
export async function eligiblePair(db: Db, x: string, y: string): Promise<[string, string] | null> {
  if (x === y) return null;
  const ok = await eligibleIds(db);
  return ok.has(x) && ok.has(y) ? pairKey(x, y) : null;
}

/** Every pair of the characters who can be in after dark, with how far each pair's scene has gone for this admin. */
export async function listCastPairs(db: Db, adminId: string) {
  const cast = [...(await eligibleIds(db))];
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
      pairs.push({ a: { id: a, name: names.get(a) ?? a }, b: { id: b, name: names.get(b) ?? b }, lines: scenes.get(`${a}/${b}`) ?? 0, path: `/admin/after-dark/${a}/${b}` });
    }
  }
  return pairs;
}

async function latestDate(db: Db, a: string, b: string): Promise<LatestDate | null> {
  const { rows } = await db.query<LatestDate>(
    `select setting, ending, character_a, transcript from episodes
      where status = 'ready' and varies_episode_id is null and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))
      order by created_at desc limit 1`,
    [a, b],
  );
  return rows[0] ?? null;
}

/** The admin's scene for a pair of this season's cast, made on first open. Null for any other pair. */
export async function openScene(db: Db, adminId: string, x: string, y: string): Promise<AdultScene | null> {
  const pair = await eligiblePair(db, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  await db.query(`insert into adult_scenes (id, owner_id, character_a, character_b) values ($1, $2, $3, $4) on conflict do nothing`, [
    crypto.randomUUID(),
    adminId,
    a,
    b,
  ]);
  const row = (await db.query<{ id: string; lines: SceneLine[] }>(`select id, lines from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, a, b]))
    .rows[0];
  const [ca, cb, date] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b), latestDate(db, a, b)]);
  return {
    id: row.id,
    lines: row.lines ?? [],
    a: { id: a, name: ca?.name ?? a },
    b: { id: b, name: cb?.name ?? b },
    date: date ? { setting: date.setting, ending: date.ending } : null,
  };
}

const sheetOf = (c: Character | null, side: "a" | "b") =>
  c
    ? [
        `${side.toUpperCase()}: ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}.`,
        `Bio: ${c.bio}`,
        `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
        c.voice ? `Voice: ${c.voice}` : "",
        c.look.appearance ? `Looks: ${c.look.appearance}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${side.toUpperCase()}: unknown`;

/** The prompt for the next lines: who they are, their latest date, the scene so far, and the admin's steer. */
export function sceneMessages(
  a: Character | null,
  b: Character | null,
  date: LatestDate | null,
  lines: SceneLine[],
  direction: string | null,
  aId?: string,
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
    sceneTail.length ? `The scene so far:\n${sceneTail.join("\n")}` : "The scene starts now.",
  ]
    .filter((x) => x !== "")
    .join("\n");
  // The model client asks for a JSON object (response_format json_object), so the lines come inside one.
  const user =
    `Write the next ${LINES_PER_TURN} lines of the scene, alternating between ${first("a")} and ${first("b")}: what each says, with any action in *asterisks*.` +
    (direction ? ` Steer the scene this way: ${direction}` : "") +
    ` Reply with a JSON object: {"lines": [{"who": "a", "text": "..."}, {"who": "b", "text": "..."}], "explicit": false, "picture": null}, where "a" is ${first("a")} and "b" is ${first("b")}.` +
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
        | { who?: string; text?: string; lines?: { who?: string; text?: string }[] }
        | { who?: string; text?: string }[];
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.lines) ? parsed.lines : [parsed];
      const out = arr
        .map((x) => ({ side: typeof x.who === "string" ? sideOf(x.who.trim().toLowerCase()) : null, text: x.text }))
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
export type SceneMeta = { explicit: boolean; picture: { of: "a" | "b" | "both"; description: string } | null };

export function parseSceneMeta(raw: string): SceneMeta {
  try {
    const j = JSON.parse(raw.trim()) as { explicit?: unknown; picture?: { of?: unknown; description?: unknown } | null };
    const p = j.picture;
    const of = p && (p.of === "a" || p.of === "b" || p.of === "both") ? p.of : null;
    const description = p && typeof p.description === "string" ? p.description.trim().slice(0, 400) : "";
    return { explicit: j.explicit === true, picture: of && description ? { of, description } : null };
  } catch {
    return { explicit: false, picture: null };
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
  const steer = direction?.trim().slice(0, DIRECTION_MAX) || null;
  if (steer && !checkAdultText({ direction: steer }).ok) {
    return { ok: false, status: 422, message: "That steer crosses one of the two lines (nobody under 18, no real people)." };
  }
  const [a, b, date] = await Promise.all([loadCharacter(db, scene.a.id), loadCharacter(db, scene.b.id), latestDate(db, scene.a.id, scene.b.id)]);
  let raw: string;
  try {
    raw = await (await adultModel(db)).complete(sceneMessages(a, b, date, scene.lines, steer, scene.a.id), { temperature: 0.9 });
  } catch (err) {
    return { ok: false, status: 502, message: `The local model didn't answer (${err instanceof Error ? err.message : "error"}). Is Ollama running?` };
  }
  const written = parseSceneLines(raw, { a: scene.a.name, b: scene.b.name });
  const kept = written.filter((l) => checkAdultText({ line: l.text }).ok);
  if (!kept.length) {
    return { ok: false, status: 422, message: written.length ? "Every line crossed one of the two lines and was dropped. Try again." : "The model's reply had no lines in it. Try again." };
  }
  const lines = [...scene.lines, ...kept];
  await db.query(`update adult_scenes set lines = $2::jsonb, updated_at = now() where id = $1`, [scene.id, JSON.stringify(lines)]);
  // Pictures (lib/adult/media.ts), only with a fal key: each character's baseline the first time it turns explicit,
  // and a new one only when they asked and agreed in these lines. A failed picture never loses the lines.
  const pictures: Media[] = [];
  let picture_note: string | undefined;
  const meta = parseSceneMeta(raw);
  if ((meta.explicit || meta.picture) && a && b && (await adultKeys(db).catch(() => ({ fal: null }))).fal) {
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
  return { ok: true, scene: { ...scene, lines }, added: kept.length, held: written.length - kept.length, pictures, ...(picture_note ? { picture_note } : {}) };
}

/** Starts the pair's scene again from the top. */
export async function resetScene(db: Db, adminId: string, x: string, y: string): Promise<void> {
  const pair = await eligiblePair(db, x, y);
  if (!pair) return;
  await db.query(`update adult_scenes set lines = '[]'::jsonb, updated_at = now() where owner_id = $1 and character_a = $2 and character_b = $3`, [adminId, ...pair]);
}
