/**
 * Fixtures for the Shorts suites (lib/adult/shorts.ts, lib/adult/predictions.ts, lib/adult/monologues.ts): a two-chapter
 * night of PG placeholder lines, stored the way a scene step stores them (with the owner's private notes on every line),
 * an admin, a subscriber, and the requests the routes take.
 */
import { POST as panelPost } from "@/app/api/admin/after-dark/shorts/route";
import type { PlaceStop } from "@/lib/adult/continuity";
import { claimAdmin } from "@/lib/admins";
import type { Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, userIdOf } from "./helpers";

/** Three of the house cast, lower id first; OFF is a fourth, kept off the season's cast by the suites. */
export const [A, B, C, OFF] = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id).sort();

export const session = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];

export async function admin(db: Db) {
  const id = userIdOf(newUserCookie());
  await claimAdmin(db, id);
  return { id, cookie: session(id) };
}

/** Someone After Dark is open to who isn't an admin: an active subscription and a passed age check. */
export async function subscriber(db: Db, name?: string) {
  const id = userIdOf(newUserCookie());
  await db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  if (name) await db.query(`insert into profiles (user_id, name) values ($1, $2)`, [id, name]);
  return { id, cookie: session(id) };
}

export const req = (method: string, path: string, body?: unknown, cookie?: string, ua?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(ua ? { "user-agent": ua } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** A line with the owner's private notes on it: none of these may reach a viewer. */
export const line = (who: "a" | "b", text: string, extra: Record<string, unknown> = {}) => ({
  who,
  text,
  why: `PRIVATE-WHY ${text}`,
  memory: "PRIVATE-MEMORY",
  fact_ids: ["PRIVATE-FACT"],
  stage: 0,
  ...extra,
});

/** Chapter 1: tea on the harbour, B takes A's hand first (line 4), and they agree to go to A's flat. */
export const CH1 = [
  line("a", "*smiles* You kept me waiting by the railing."),
  line("b", "Seven boats. I counted every one of them."),
  line("a", "Then I owe you a cup of my terrible tea."),
  line("b", "Terrible how? Weak, or a crime against leaves?"),
  line("b", "*takes her hand* A crime, but a warm one.", { stage: 1 }),
  line("a", "Then I'm staying for the crime.", { stage: 1 }),
  line("a", "Shall we go up to mine? It's warmer.", { stage: 1 }),
  line("b", "Yes. Lead the way.", { stage: 1, moved_to: "her flat" }),
];
/** Chapter 2: at A's flat, as far as a kiss. */
export const CH2 = [
  line("a", "*kisses him* Welcome to the flat.", { stage: 2 }),
  line("b", "It's smaller than you said.", { stage: 2 }),
  line("a", "The view makes up for it.", { stage: 2 }),
  line("b", "*leans on the window* It does.", { stage: 2 }),
];
export const HISTORY: PlaceStop[] = [
  { place: "the harbour", set: "the harbour", home: null, chapter: 1 },
  { place: "her flat", set: "her flat", home: "a", chapter: 1 },
];

/** A saved chapter (adult_nights), filed `ago` minutes ago. */
export async function night(
  db: Db,
  owner: string,
  opts: { id: string; a?: string; b?: string; chapter?: number | null; lines?: unknown[]; ago?: number; history?: unknown[]; stage?: number },
) {
  const [a, b] = [opts.a ?? A, opts.b ?? B].sort();
  await db.query(
    `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, chapter, place_history, set_place, created_at)
     values ($1, $2, $3, $4, $5::jsonb, 'her flat', $6, $7, $8::jsonb, 'her flat', now() - ($9 || ' minutes')::interval)`,
    [opts.id, owner, a, b, JSON.stringify(opts.lines ?? CH1), opts.stage ?? 2, opts.chapter === undefined ? 1 : opts.chapter, JSON.stringify(opts.history ?? HISTORY), String(opts.ago ?? 10)],
  );
}

/** The admin's two-chapter night of A and B, finished (Start over set the scene back to chapter 1). */
export async function wholeNight(db: Db, owner: string) {
  await night(db, owner, { id: "n1", chapter: 1, lines: CH1, ago: 30 });
  await night(db, owner, { id: "n2", chapter: 2, lines: CH2, ago: 20 });
  await db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, chapter) values ('s1', $1, $2, $3, 1) on conflict do nothing`, [owner, A, B]);
}

/** Publishes the whole night as a Short (no cover), through the admin's route; its id. */
export async function publishNight(owner: { cookie: string }, title = "A harbour night"): Promise<string> {
  const res = await panelPost(req("POST", "/api/admin/after-dark/shorts", { a: A, b: B, night_id: "n1", title, cover_id: null }, owner.cookie));
  if (res.status !== 201) throw new Error(`publishing: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { short: { id: string } }).short.id;
}
