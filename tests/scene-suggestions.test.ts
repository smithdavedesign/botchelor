import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/episodes/[id]/set-scene/route";
import { claimAdmin } from "@/lib/admins";
import type { Turn } from "@/lib/conversation";
import { markProposed, pendingSuggestion, settleSuggestions, suggestedPlace } from "@/lib/scene-suggestions";
import { api, jsonRequest, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// Set the scene on a filming date (lib/scene-suggestions.ts): 1 bought token, kept only if they go.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});

let n = 0;
async function filming(o: { creator: string; a: string; b: string; moves?: boolean; status?: string; performed_by?: string }): Promise<string> {
  const id = `ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, setup, performed_by)
     values ($1, $2, $3, $4, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'second_date', $5, $6::jsonb, $7)`,
    [id, o.creator, o.a, o.b, o.status ?? "generating", JSON.stringify({ venue: "rooftop_bar", moves: o.moves ?? true }), o.performed_by ?? "platform"],
  );
  return id;
}
const suggest = (id: string, place: string, cookie: string) => POST(jsonRequest(`/api/episodes/${id}/set-scene`, { place }, { cookie }), { params: Promise.resolve({ id }) });
const grant = (userId: string, n = 2) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), userId, n]);
const used = async (userId: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [userId])).rows[0]?.used ?? 0;

async function aDate(opts: { moves?: boolean; status?: string; performed_by?: string } = {}) {
  const cookie = newUserCookie();
  const me = userIdOf(cookie);
  const a = (await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), cookie)).json()).id as string;
  const b = (await (await api.createCharacter(validCharacter({ name: "Nell Abiodun" }), newUserCookie())).json()).id as string;
  return { cookie, me, a, b, id: await filming({ creator: me, a, b, ...opts }) };
}

describe("set the scene on a filming date", () => {
  it("costs 1 bought token; kept when they go there, given back when they don't", async () => {
    const d = await aDate();
    expect((await suggest(d.id, "a rooftop pool", d.cookie)).status).toBe(402);
    await grant(d.me);
    const ok = await (await suggest(d.id, "a rooftop pool", d.cookie)).json();
    expect(ok.suggestion).toMatchObject({ to: "elsewhere@a rooftop pool", label: "a rooftop pool" });
    expect(await used(d.me)).toBe(1);
    expect((await suggest(d.id, "the beach", d.cookie)).status).toBe(409);
    const s = await pendingSuggestion(t.db, d.id);
    await markProposed(t.db, s!.id);
    expect(await pendingSuggestion(t.db, d.id)).toBeNull();
    const went: Turn[] = [{ side: "b", act: 1, dialogue: "Yes.", action: "", emotion: "", interest: 0.6, moved_to: "elsewhere@a rooftop pool" }];
    await settleSuggestions(t.db, d.id, went);
    expect(await used(d.me)).toBe(1);

    const d2 = await aDate();
    await grant(d2.me);
    await suggest(d2.id, "a lighthouse", d2.cookie);
    expect(await used(d2.me)).toBe(1);
    await settleSuggestions(t.db, d2.id, []);
    expect(await used(d2.me)).toBe(0);
    await settleSuggestions(t.db, d2.id, []);
    expect(await used(d2.me)).toBe(0);
  });

  it("only its own creator, only while it's filmed, only a date that can move, never an agent's own date; admins don't pay", async () => {
    const d = await aDate();
    await grant(d.me);
    expect((await suggest(d.id, "a lighthouse", newUserCookie())).status).toBe(404);
    expect((await suggest((await aDate({ status: "ready" })).id, "a lighthouse", d.cookie)).status).toBe(404);
    const done = await aDate({ status: "ready" });
    await grant(done.me);
    expect((await suggest(done.id, "a lighthouse", done.cookie)).status).toBe(409);
    const still = await aDate({ moves: false });
    await grant(still.me);
    expect((await suggest(still.id, "a lighthouse", still.cookie)).status).toBe(409);
    const agent = await aDate({ performed_by: "agent" });
    await grant(agent.me);
    expect((await (await suggest(agent.id, "a lighthouse", agent.cookie)).json()).error).toBe("self_performed");
    const boss = await aDate();
    await claimAdmin(t.db, boss.me);
    expect((await suggest(boss.id, "a lighthouse", boss.cookie)).status).toBe(200);
    expect(await used(boss.me)).toBe(0);
  });

  it("takes the place exactly as typed (one of their homes when it says so), never the nearest library venue; refuses what the show can't use", async () => {
    expect(suggestedPlace("a rooftop pool", ["Chud", "Nell"])).toBe("elsewhere@a rooftop pool");
    expect(suggestedPlace("back to my place", ["Chud Crusher", "Nell"])).toBe("home@Chud's place");
    expect(suggestedPlace("a lighthouse!", ["Chud", "Nell"])).toBe("elsewhere@a lighthouse");
    const d = await aDate();
    await grant(d.me);
    expect((await suggest(d.id, "Elon Musk's house", d.cookie)).status).toBe(422);
    expect(await used(d.me)).toBe(0);
  });
});
