import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The character page reads the viewer from next/headers: hand it this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
// The owner's controls are client components that ask for the router; a static render has none.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CharactersPage from "@/app/characters/page";
import { directoryEntries, listDirectory } from "@/lib/directory";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// The /characters directory (lib/directory.ts): everyone, private ones by name only and never linked.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

async function made(name: string, cookie = newUserCookie()) {
  return { cookie, id: (await (await api.createCharacter(validCharacter({ name }), cookie)).json()).id as string };
}

describe("the character directory", () => {
  it("lists the house first, then everyone else newest first; a private character keeps only its name", async () => {
    const open = await made("Open Book");
    const hidden = await made("Quiet Type");
    expect((await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie)).status).toBe(200);
    const { entries, total } = await listDirectory(t.db);
    expect(total).toBeGreaterThanOrEqual(HOUSE_CHARACTERS.length + 2);
    expect(entries[0].house).toBe(true);
    const mine = entries.filter((e) => [open.id, hidden.id].includes(e.id));
    expect(mine.map((e) => [e.name, e.private, e.traits.length > 0])).toEqual([
      ["Quiet Type", true, false],
      ["Open Book", false, true],
    ]);
    expect((await directoryEntries(t.db, [hidden.id]))[0]).toMatchObject({ private: true, traits: [], portrait: null });
  });

  it("renders the season, the candidates and everyone, linking public characters and never a private one", async () => {
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const html = renderToStaticMarkup(await CharactersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/This season: /);
    expect(html).toMatch(/Next season&#x27;s candidates: /);
    expect(html).toContain("Quiet Type");
    expect(html).not.toContain(`/characters/${hidden.id}`);
    expect(html).toContain(`/characters/${HOUSE_CHARACTERS[0].id}`);
  });

  it("a private character's card shows only its name to others, and everything to its owner", async () => {
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const { default: CharacterPage } = await import("@/app/characters/[id]/page");
    const render = async (cookie: string | null) => {
      jar.cookies.clear();
      if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
      return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id: hidden.id }) }));
    };
    const stranger = await render(newUserCookie());
    expect(stranger).toContain("Quiet Type");
    expect(stranger).toMatch(/keeps this character private/);
    expect(stranger).not.toContain(validCharacter().bio as string);
    const owner = await render(hidden.cookie);
    expect(owner).toContain(validCharacter().bio as string);
    expect(owner).toMatch(/Make public/);
  });
});
