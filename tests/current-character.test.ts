// "The character I'm working with" (lib/current-character.ts; David 2026-11-16): the address first, then the one
// remembered from the last door, then the page's own default. Chat's face row only filters, and counts what's new for
// each face, so picking one never hides another's news.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CharacterTabs from "@/app/CharacterTabs";
import { newsOfRows, rowsOfCharacter, type ChatRow } from "@/lib/chat-inbox";
import { CHARACTER_COOKIE, pickCharacter, rememberedCharacter } from "@/lib/current-character";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

const store = (value?: string) => ({ get: (name: string) => (name === CHARACTER_COOKIE && value !== undefined ? { value } : undefined) });
const MINE = [{ id: "ambrose" }, { id: "nell" }, { id: "ira" }];

describe("which character a page is about", () => {
  it("the address wins, then the remembered one, then the page's default, then the first", () => {
    expect(pickCharacter(MINE, "nell", "ira")?.id).toBe("nell");
    expect(pickCharacter(MINE, null, "ira")?.id).toBe("ira");
    expect(pickCharacter(MINE, undefined, null, MINE[1])?.id).toBe("nell");
    expect(pickCharacter(MINE, null, null)?.id).toBe("ambrose");
  });

  it("never picks a character that isn't theirs, from the address or the cookie", () => {
    expect(pickCharacter(MINE, "someone-elses", "also-not-mine")?.id).toBe("ambrose");
    expect(pickCharacter([], "nell", "nell")).toBeNull();
  });

  it("reads the cookie only when it looks like an id", () => {
    expect(rememberedCharacter(store("3f2a9c1e-1b2c-4d5e-8f90-1234567890ab"))).toBe("3f2a9c1e-1b2c-4d5e-8f90-1234567890ab");
    expect(rememberedCharacter(store("house-nell"))).toBe("house-nell");
    expect(rememberedCharacter(store("<script>"))).toBeNull();
    expect(rememberedCharacter(store(""))).toBeNull();
    expect(rememberedCharacter(store())).toBeNull();
  });
});

const face = (id: string) => ({ id, name: id, hue: null, house: false, portrait: null });
const row = (over: Partial<ChatRow>): ChatRow => ({ kind: "dating", key: "k", href: "/x", who: face("dex"), mine: null, title: "t", says: "s", last: null, at: "2026-11-16T10:00:00.000Z", unread: 0, new_match: false, ...over });

describe("Chat's face row is a filter", () => {
  const rows: ChatRow[] = [
    row({ key: "1", mine: face("ambrose"), who: face("dex"), unread: 2 }),
    row({ key: "2", mine: face("nell"), who: face("teo"), new_match: true }),
    row({ key: "3", kind: "you", who: face("nell"), unread: 1 }),
    row({ key: "4", kind: "you", who: face("house-juniper") }),
  ];

  it("a character's rows are its own threads and the viewer's thread with it", () => {
    expect(rowsOfCharacter(rows, "ambrose").map((r) => r.key)).toEqual(["1"]);
    expect(rowsOfCharacter(rows, "nell").map((r) => r.key)).toEqual(["2", "3"]);
    expect(rowsOfCharacter(rows, "ira")).toEqual([]);
  });

  it("counts what's new for each face, so one picked never hides another's news", () => {
    const news = newsOfRows(rows, ["ambrose", "nell", "ira"]);
    expect(news.get("ambrose")).toMatchObject({ texts: 2, matches: 0 });
    expect(news.get("nell")).toMatchObject({ texts: 1, matches: 1 });
    expect(news.has("ira")).toBe(false);
  });
});

describe("the face row (app/CharacterTabs.tsx)", () => {
  const chars = [
    { id: "ambrose", name: "Ambrose Fenn", hue: 10, portrait: null },
    { id: "nell", name: "Nell Abiodun", hue: 200, portrait: null },
  ];
  const html = (props: Partial<Parameters<typeof CharacterTabs>[0]>) => renderToStaticMarkup(createElement(CharacterTabs, { characters: chars, current: "", href: "/chat?character=", label: "Whose chats", ...props }));

  it("is absent with one character: most people never see a switcher", () => {
    expect(html({ characters: chars.slice(0, 1), all: { href: "/chat", label: "All" } })).toBe("");
  });

  it("on Chat leads with All, current while nobody is picked, and each face opens that character's chats", () => {
    const all = html({ all: { href: "/chat", label: "All" } });
    expect(all).toMatch(/<a[^>]*href="\/chat"[^>]*aria-current="page"[^>]*>[\s\S]*?All/);
    expect(all).toContain('href="/chat?character=ambrose"');
    expect(all).toContain('href="/chat?character=nell"');
    const one = html({ current: "nell", all: { href: "/chat", label: "All" } });
    expect(one).not.toMatch(/href="\/chat"[^>]*aria-current="page"/);
    expect(one).toMatch(/aria-current="page"[^>]*href="\/chat\?character=nell"|href="\/chat\?character=nell"[^>]*aria-current="page"/);
  });

  it("without `all` (the Studio, Matches, the deck) every entry is a character", () => {
    const studio = html({ current: "ambrose", href: "/studio?character=", label: "Whose studio" });
    expect(studio).not.toContain("character-tab-all");
    expect(studio).toContain('href="/studio?character=nell"');
  });
});
