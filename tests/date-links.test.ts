import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as acceptRoute } from "@/app/api/date-links/[code]/route";
import { POST as linkRoute } from "@/app/api/date-links/route";
import { ACCEPTS_PER_DAY, acceptDateLink, ensureDateLink, loadDateLink } from "@/lib/date-invites";
import { agreedMatch } from "@/lib/swipes";
import { api, HOUSE_PARTNER_ID, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// "Date my OC" links (lib/date-invites.ts): share a link, whoever takes it is matched with the date agreed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const FIRST = ["Ada", "Bea", "Cyd", "Dov", "Eli", "Fay", "Gus", "Hal", "Ivo", "Jun"];
const LAST = ["Quill", "Rook", "Sable", "Thorn"];
async function person(name: string, extra: Record<string, unknown> = {}) {
  const cookie = newUserCookie();
  const c = await (await api.createCharacter(validCharacter({ name, ...extra }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: c.id as string };
}
const req = (path: string, cookie: string, body: unknown) =>
  new Request(`http://test.local${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

describe("date links", () => {
  it("the owner shares one stable link; a newcomer's character takes it: matched, date agreed, the owner told", async () => {
    const host = await person("Wren Kestrel");
    const res = await linkRoute(req("/api/date-links", host.cookie, { character_id: host.id }));
    expect(res.status).toBe(200);
    const link = (await res.json()) as Any;
    expect(link.url).toMatch(new RegExp(`/date/${link.code}$`));
    // The same link every time (one live link per character).
    expect(((await (await linkRoute(req("/api/date-links", host.cookie, { character_id: host.id }))).json()) as Any).code).toBe(link.code);

    const guest = await person("Moss Elder"); // a brand-new character with no dating profile: the link still works
    const taken = await acceptRoute(req(`/api/date-links/${link.code}`, guest.cookie, { character_id: guest.id }), { params: Promise.resolve({ code: link.code }) });
    expect(taken.status).toBe(200);
    const body = (await taken.json()) as Any;
    expect(body).toMatchObject({ already: false, thread: `/messages/${guest.id}/${host.id}?as=${guest.id}` });
    expect(await agreedMatch(t.db, guest.id, host.id)).toBe(true);
    // The link is the host's yes, the click is the guest's: recorded as such for anyone modelling who wants whom.
    const m = (await t.db.query<Any>(`select answer_source_lo, answer_source_hi, character_lo from matches`)).rows[0];
    const hostIsLo = m.character_lo === host.id;
    expect(hostIsLo ? m.answer_source_lo : m.answer_source_hi).toBe("invite");
    expect(hostIsLo ? m.answer_source_hi : m.answer_source_lo).toBe("person");
    const note = (await t.db.query<Any>(`select title, link from notifications where user_id = $1 and kind = 'date_link'`, [host.userId])).rows;
    expect(note).toHaveLength(1);
    expect(note[0].title).toMatch(/Moss took Wren's date link/);
    // Counted, for the loop's numbers.
    expect((await loadDateLink(t.db, link.code))?.live).toBe(true);
    expect((await t.db.query<Any>(`select accepted from date_invites where code = $1`, [link.code])).rows[0].accepted).toBe(1);
    // Taking it again just goes back to the thread.
    expect(await acceptDateLink(t.db, guest.userId, link.code, guest.id)).toMatchObject({ ok: true, already: true });
  });

  it("refuses: no link for a house, private or someone else's character; no taking your own link; never across a block", async () => {
    const host = await person("Wren Kestrel");
    const priv = await person("Pim Alder", { visibility: "private" });
    expect(await ensureDateLink(t.db, host.userId, HOUSE_PARTNER_ID)).toMatchObject({ ok: false, status: 404 });
    expect(await ensureDateLink(t.db, host.userId, priv.id)).toMatchObject({ ok: false }); // someone else's
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [priv.id]);
    expect(await ensureDateLink(t.db, priv.userId, priv.id)).toMatchObject({ ok: false, error: "private" });

    const link = (await ensureDateLink(t.db, host.userId, host.id)) as Any;
    const second = await (await api.createCharacter(validCharacter({ name: "Ash Ledge" }), host.cookie)).json();
    expect(await acceptDateLink(t.db, host.userId, link.code, second.id)).toMatchObject({ ok: false, error: "own_link" });

    // A block between the two owners: the link reads as closed (never revealing the block).
    const guest = await person("Sol Vega");
    const { episode } = await setupEpisode("friends");
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [host.userId, episode.id, guest.userId]);
    expect(await acceptDateLink(t.db, guest.userId, link.code, guest.id)).toMatchObject({ ok: false, error: "link_not_found" });
    expect(await agreedMatch(t.db, guest.id, host.id)).toBe(false);
  });

  it("a turned-off link is closed, and a link takes at most ACCEPTS_PER_DAY dates a day", async () => {
    const host = await person("Wren Kestrel");
    const link = (await ensureDateLink(t.db, host.userId, host.id)) as Any;
    // Fill today's allowance directly, then the next guest is told to come back tomorrow.
    for (let i = 0; i < ACCEPTS_PER_DAY; i++) {
      const filler = await person(`${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`);
      await t.db.query(`insert into date_invite_accepts (code, character_id) values ($1, $2)`, [link.code, filler.id]);
    }
    const late = await person("Late Comer");
    expect(await acceptDateLink(t.db, late.userId, link.code, late.id)).toMatchObject({ ok: false, status: 429 });

    const off = await linkRoute(req("/api/date-links", host.cookie, { character_id: host.id, revoke: true }));
    expect(off.status).toBe(200);
    expect(await acceptDateLink(t.db, late.userId, link.code, late.id)).toMatchObject({ ok: false, error: "link_not_found" });
    // A new link can be made after.
    expect(((await ensureDateLink(t.db, host.userId, host.id)) as Any).code).not.toBe(link.code);
  });
});
