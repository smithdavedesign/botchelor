// The narrated style in a companion scene (lib/companion.ts speak): a scene reply comes with its prose beside the words
// (never in them: the voice reads the words), only for someone the style is open to, and never while texting.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { setCompanionModelForTests } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setStyle } from "@/lib/writing-style";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const PLACE = "rooftop_bar";
let narrated = 0;

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  narrated = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are the narrator of a story told in dialogue")) {
        narrated++;
        return JSON.stringify({ beats: [{ n: 1, before: "She leaned on the railing and looked at you over her glass.", after: "The city hummed below." }] });
      }
      if (!system.startsWith("You are ")) return "{}";
      return system.includes("playing a scene together") ? JSON.stringify({ say: "You made it.", do: "leans on the railing" }) : JSON.stringify({ messages: ["Hey you."] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const req = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const person = async (admin: boolean) => {
  const id = crypto.randomUUID();
  if (admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const open = async (cookie: string) => ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id as string;
const act = async (cookie: string, id: string, body: Record<string, unknown>) => {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
};

describe("a narrated companion scene", () => {
  it("gives a scene reply its prose, beside the words, for an admin on the narrated style", async () => {
    const me = await person(true);
    await setStyle(t.db, me.id, "show", "narrated");
    const id = await open(me.cookie);
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(r.status).toBe(200);
    const opener = r.body.view.messages.at(-1);
    expect(opener).toMatchObject({
      role: "character",
      text: "You made it.",
      action: "leans on the railing",
      beat: { before: "She leaned on the railing and looked at you over her glass.", after: "The city hummed below." },
    });
    expect(narrated).toBe(1);
    // The words are stored without the prose: it's in its own column.
    const row = (await t.db.query<{ text: string; beat: unknown }>(`select text, beat from companion_messages where thread_id = $1 and role = 'character' order by created_at desc limit 1`, [id])).rows[0];
    expect(row.text).toBe("You made it.");
    expect(row.beat).toBeTruthy();
  });

  it("never narrates a text, or a scene for someone the style isn't open to", async () => {
    const me = await person(true);
    await setStyle(t.db, me.id, "show", "narrated");
    const id = await open(me.cookie);
    const texted = await act(me.cookie, id, { action: "send", text: "Hi there." });
    expect(texted.body.view.messages.at(-1).beat ?? null).toBeNull();
    expect(narrated).toBe(0);

    const other = await person(false);
    await t.db.query(`insert into writing_prefs (user_id, show_style) values ($1, 'narrated')`, [other.id]);
    const theirs = await open(other.cookie);
    const r = await act(other.cookie, theirs, { action: "scene", place: PLACE });
    expect(r.body.view.messages.at(-1).beat ?? null).toBeNull();
    expect(narrated).toBe(0);
  });
});
