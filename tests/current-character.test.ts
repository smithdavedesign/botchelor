// "The character I'm working with" (lib/current-character.ts; David 2026-11-16, and 2026-11-18: one face in the header
// instead of a switcher on every page): the address first, then the one remembered, then the page's own default. The
// header's picker (app/CharacterPicker.tsx) shows it and switches it; a pick takes the page with it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CharacterPicker, { aboutCharacter, pickerOrder } from "@/app/CharacterPicker";
import SwitchCharacter from "@/app/SwitchCharacter";
import { rowsOfCharacter, type ChatRow } from "@/lib/chat-inbox";
import { CHARACTER_COOKIE, pickCharacter, pickedHref, rememberedCharacter, rememberedFromCookieString } from "@/lib/current-character";
import type { PickerCharacter } from "@/lib/my-characters";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/studio", useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }) }));

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

  it("reads the cookie only when it looks like an id, from the request and from the browser's string", () => {
    expect(rememberedCharacter(store("3f2a9c1e-1b2c-4d5e-8f90-1234567890ab"))).toBe("3f2a9c1e-1b2c-4d5e-8f90-1234567890ab");
    expect(rememberedCharacter(store("house-nell"))).toBe("house-nell");
    expect(rememberedCharacter(store("<script>"))).toBeNull();
    expect(rememberedCharacter(store(""))).toBeNull();
    expect(rememberedCharacter(store())).toBeNull();
    expect(rememberedFromCookieString(`theme=dark; ${CHARACTER_COOKIE}=nell; other=1`)).toBe("nell");
    expect(rememberedFromCookieString(`${CHARACTER_COOKIE}=%3Cscript%3E`)).toBeNull();
    expect(rememberedFromCookieString(`${CHARACTER_COOKIE}=%E0%A4%A`)).toBeNull();
    expect(rememberedFromCookieString("theme=dark")).toBeNull();
    expect(rememberedFromCookieString("")).toBeNull();
  });
});

describe("where a pick in the header takes the page (pickedHref)", () => {
  it("a page whose address names a character opens on the new one, back on its first page, keeping the rest", () => {
    expect(pickedHref("/studio?character=ambrose", "nell")).toBe("/studio?character=nell");
    expect(pickedHref("/matches?character=ambrose&show=over&page=3#messages-title", "nell")).toBe("/matches?character=nell&show=over#messages-title");
    expect(pickedHref("/chat?show=dating&character=ambrose", "nell")).toBe("/chat?show=dating&character=nell");
    // A card's "Send Ambrose" landing on someone: the sheet's sender follows too.
    expect(pickedHref("/characters/house-juniper?send=ambrose#date", "nell")).toBe("/characters/house-juniper?send=nell#date");
  });

  it("any other page is only read again (it follows the cookie): Chat stays on every character's threads", () => {
    expect(pickedHref("/chat", "nell")).toBeNull();
    expect(pickedHref("/studio", "nell")).toBeNull();
    expect(pickedHref("/characters?tab=cast&page=2", "nell")).toBeNull();
  });
});

const face = (id: string, name: string, over: Partial<PickerCharacter> = {}): PickerCharacter => ({ id, name, hue: 10, portrait: null, taken: [], news: 0, ...over });

describe("the header's face (app/CharacterPicker.tsx)", () => {
  const chars = [face("ambrose", "Ambrose Fenn"), face("nell", "Nell Abiodun", { news: 3 }), face("lexi", "Lexi Moreau", { taken: ["Dex Marlow", "Sam Reyes"] })];
  const html = (props: Partial<Parameters<typeof CharacterPicker>[0]> = {}) => renderToStaticMarkup(createElement(CharacterPicker, { characters: chars, initial: "ambrose", ...props }));

  it("shows the one remembered, with a dot when another has news, and a closed panel of all of them", () => {
    const out = html();
    const button = out.match(/<button[^>]*class="char-picker-button"[^>]*>.*?<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-label="Your character: Ambrose. Nell has news. Switch"');
    expect(button).toContain('<span class="char-picker-name">Ambrose</span>');
    expect(button).toContain('class="char-picker-dot"');
    // The panel is in the page, hidden until opened.
    expect(out).toMatch(/<div[^>]*class="char-picker-menu"[^>]*hidden=""/);
    expect(out).toContain('<a href="/characters/ambrose" class="char-picker-page">Ambrose&#x27;s page</a>');
    expect(out).toContain('<a href="/create">+ Make another character</a>');
    expect(out).toContain('<a href="/characters?tab=yours">All of yours</a>');
    const tiles = [...out.matchAll(/<button[^>]*class="char-picker-tile[^"]*"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tiles).toHaveLength(3);
    // News first, then the rest as they were.
    expect(tiles[0]).toContain(">Nell<");
    expect(tiles[0]).toContain('<span class="nav-count" aria-hidden="true">3</span>');
    expect(tiles[1]).toContain('aria-current="true"');
    expect(tiles[1]).toContain('aria-label="Ambrose (playing as)"');
    expect(tiles[2]).toContain('class="char-picker-tile is-taken"');
    expect(tiles[2]).toContain('aria-label="Lexi: taken (dating Dex and Sam)"');
    expect(tiles[2]).toContain(">💍 Taken<");
  });

  it("falls back to the newest when the remembered one isn't theirs (any more); no dot without news elsewhere", () => {
    const out = html({ initial: "deleted-one", characters: [face("ambrose", "Ambrose Fenn"), face("nell", "Nell Abiodun")] });
    expect(out).toContain('<span class="char-picker-name">Ambrose</span>');
    expect(out).not.toContain("char-picker-dot");
    expect(out).toContain('aria-label="Your character: Ambrose. Switch"');
  });

  it("their own news isn't news elsewhere: the dot is only for the others", () => {
    expect(html({ initial: "nell" })).not.toContain("char-picker-dot");
  });

  it("with one character: the face and the way to its page and to another, no grid", () => {
    const out = html({ characters: chars.slice(0, 1) });
    expect(out).toContain('<span class="char-picker-name">Ambrose</span>');
    expect(out).toContain('aria-label="Your character: Ambrose. Open"');
    expect(out).not.toContain("char-picker-tile");
    expect(out).not.toContain("All of yours");
    expect(out).toContain("+ Make another character");
  });

  it("is nothing without a character", () => {
    expect(html({ characters: [] })).toBe("");
  });

  it("the deck's bar wears the same picker", () => {
    expect(html({ variant: "bar" })).toContain('class="char-picker char-picker--bar"');
    expect(html()).toContain('class="char-picker char-picker--nav"');
  });

  it("says who a taken one is dating and what's new, and orders news first", () => {
    expect(aboutCharacter(face("a", "Ada Lumen", { taken: ["Dex Marlow"], news: 2 }))).toBe("Ada: taken (dating Dex), 2 new");
    expect(aboutCharacter(face("a", "Ada Lumen", { taken: ["Dex Marlow", "Sam Reyes", "Ro Vale"] }))).toBe("Ada: taken (dating Dex, Sam and Ro)");
    expect(aboutCharacter(face("a", "Ada Lumen"))).toBe("Ada");
    const order = pickerOrder([face("a", "A"), face("b", "B", { news: 1 }), face("c", "C"), face("d", "D", { news: 5 })]).map((c) => c.id);
    expect(order).toEqual(["b", "d", "a", "c"]);
  });
});

describe("a heading's name opens the picker (app/SwitchCharacter.tsx)", () => {
  it("is the name in the heading's own type, or a button of its own", () => {
    const name = renderToStaticMarkup(createElement(SwitchCharacter, { name: "Ambrose" }));
    expect(name).toContain('class="heading-switch"');
    expect(name).toContain('aria-haspopup="dialog"');
    expect(name).toMatch(/title="Ambrose: switch character">Ambrose<\/button>$/);
    expect(renderToStaticMarkup(createElement(SwitchCharacter, { name: "Lexi", label: "Swipe for another of yours" }))).toBe(
      '<button type="button" class="button secondary" aria-haspopup="dialog">Swipe for another of yours</button>',
    );
  });
});

const chatFace = (id: string) => ({ id, name: id, hue: null, house: false, portrait: null });
const row = (over: Partial<ChatRow>): ChatRow => ({ kind: "dating", key: "k", href: "/x", who: chatFace("dex"), mine: null, title: "t", says: "s", last: null, at: "2026-11-16T10:00:00.000Z", unread: 0, new_match: false, ...over });

describe("Chat's \"Just {name}'s\" is a filter", () => {
  it("a character's rows are its own threads and the viewer's thread with it", () => {
    const rows: ChatRow[] = [
      row({ key: "1", mine: chatFace("ambrose"), who: chatFace("dex"), unread: 2 }),
      row({ key: "2", mine: chatFace("nell"), who: chatFace("teo"), new_match: true }),
      row({ key: "3", kind: "you", who: chatFace("nell"), unread: 1 }),
      row({ key: "4", kind: "you", who: chatFace("house-juniper") }),
    ];
    expect(rowsOfCharacter(rows, "ambrose").map((r) => r.key)).toEqual(["1"]);
    expect(rowsOfCharacter(rows, "nell").map((r) => r.key)).toEqual(["2", "3"]);
    expect(rowsOfCharacter(rows, "ira")).toEqual([]);
  });
});
