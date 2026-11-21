/**
 * /companion's phone (lib/companion-preview.ts, app/companion/CompanionPhone.tsx; the visual pop audit's leftovers):
 * one of the house cast typing the first message a conversation really opens with, and the list's faces past 64 px.
 * Pure picks and renders, plus source reads for the wiring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompanionPhone, { BEAT_MS, PHONE_FACE, rowStates, typingMs } from "@/app/companion/CompanionPhone";
import { TILE_FACE } from "@/app/companion/CompanionBrowser";
import { castOpenerLines } from "@/lib/cast-opener";
import { previewFrom, type PreviewCandidate } from "@/lib/companion-preview";
import type { LastDate } from "@/lib/last-date";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const date = (over: Partial<LastDate> = {}): LastDate => ({
  episodeId: "ep-1",
  partnerId: "house-dex",
  partner: "Dex Okafor",
  venue: "the night market",
  ending: "second_date",
  endingLabel: "Second date",
  reflection: "He laughed at the right moment and I forgot to be nervous.",
  at: "2026-11-20T21:00:00.000Z",
  dateNumber: 1,
  venueId: "night-market",
  names: ["Juniper Vale", "Dex Okafor"],
  ...over,
});
const who = (id: string, name: string, last: LastDate | null): PreviewCandidate => ({ id, name, hue: 300, portrait: `/cast/${id}-v5.webp`, last });

describe("previewFrom", () => {
  it("is whoever was on the show last, with the opener a Talk would really send", () => {
    const p = previewFrom([
      who("house-nell", "Nell Abiodun", date({ episodeId: "ep-old", at: "2026-11-18T21:00:00.000Z" })),
      who("house-juniper", "Juniper Vale", date()),
      who("house-sable", "Sable Quist", null),
    ]);
    expect(p?.id).toBe("house-juniper");
    expect(p?.lines).toEqual(castOpenerLines("Juniper Vale", date()));
    expect(p?.lines[0]).toMatch(/^Hey, I'm Juniper\. My last date was with Dex at the night market/);
    expect(p?.watch).toBe("/watch/ep-1");
    expect(p?.portrait).toBe("/cast/house-juniper-v5.webp");
  });

  it("passes over an opener that fails the thread's own checks, and is null with no aired date at all", () => {
    const p = previewFrom([
      who("house-juniper", "Juniper Vale", date({ reflection: "Honestly I want to kill myself after that one." })),
      who("house-nell", "Nell Abiodun", date({ episodeId: "ep-2", at: "2026-11-19T21:00:00.000Z" })),
    ]);
    expect(p?.id).toBe("house-nell");
    expect(previewFrom([who("house-sable", "Sable Quist", null)])).toBeNull();
  });
});

describe("the typing", () => {
  it("lands each bubble in turn, the next one typing, the rest holding their place", () => {
    expect(rowStates(3, 0, true)).toEqual(["typing", "waiting", "waiting"]);
    expect(rowStates(3, 1, false)).toEqual(["said", "waiting", "waiting"]);
    expect(rowStates(3, 1, true)).toEqual(["said", "typing", "waiting"]);
    expect(rowStates(3, 3, false)).toEqual(["said", "said", "said"]);
  });

  it("types longer lines longer, within bounds, so the whole opener takes seconds rather than a minute", () => {
    expect(typingMs("Hi")).toBe(900);
    expect(typingMs("x".repeat(80))).toBeGreaterThan(typingMs("x".repeat(40)));
    expect(typingMs("x".repeat(1000))).toBe(2200);
    const lines = castOpenerLines("Juniper Vale", date());
    const total = lines.reduce((t, l) => t + typingMs(l) + BEAT_MS, 0);
    expect(total).toBeLessThan(9000);
  });
});

describe("the phone at rest", () => {
  const lines = castOpenerLines("Juniper Vale", date());
  const html = renderToStaticMarkup(
    createElement(CompanionPhone, { preview: { id: "house-juniper", name: "Juniper Vale", hue: 300, portrait: "/cast/house-juniper-v5.webp", lines, watch: "/watch/ep-1" } }),
  );

  it("is complete before anything moves: every bubble said, no dots, the date's link showing", () => {
    expect(html.match(/companion-phone-msg is-said/g)).toHaveLength(lines.length);
    expect(html).not.toContain("chat-typing");
    expect(html).not.toContain("is-waiting");
    for (const l of lines) expect(html).toContain(l.replace(/'/g, "&#x27;"));
    expect(html).toContain('href="/watch/ep-1"');
    expect(html).toContain('<ol class="companion-phone-thread" aria-label="Juniper&#x27;s first message">');
  });

  it("groups the bubbles' corners as a thread does, and shows the face bigger than a list's", () => {
    expect(html).toMatch(/phone-msg phone-msg-them companion-phone-msg is-said starts/);
    expect(html).toMatch(/phone-msg phone-msg-them companion-phone-msg is-said ends/);
    expect(PHONE_FACE).toBeGreaterThan(64);
    expect(html).toContain('src="/cast/house-juniper-v5.webp"');
    expect(html).toContain("Juniper&#x27;s real first message.");
  });
});

describe("the wiring", () => {
  const page = read("app", "companion", "page.tsx");

  it("reads the opener on the server, kept for minutes, and never fails the page over it", () => {
    expect(page).toContain('sharedStale("companion:phone", () => companionPreview(db), 10 * 60_000).catch(() => null)');
    expect(read("app", "companion", "CompanionPhone.tsx")).toContain('import type { CompanionPreview } from "@/lib/companion-preview";');
    expect(read("app", "companion", "CompanionPhone.tsx")).not.toMatch(/import \{[^}]*\} from "@\/lib\/companion-preview"/);
  });

  it("shows the phone to anyone without a conversation yet, beside every version of the header", () => {
    expect(page.match(/<Hero preview=\{threads\.length === 0 \? preview : null\}>/g)).toHaveLength(2);
    expect(page).toContain("<Hero preview={preview}>");
    expect(page.match(/<\/Hero>/g)).toHaveLength(3);
  });

  it("gives the list's faces room (past 64 px) and their loop", () => {
    expect(TILE_FACE).toBeGreaterThan(64);
    const browser = read("app", "companion", "CompanionBrowser.tsx");
    expect(browser).toMatch(/<FaceLoop id=\{c\.id\} radius=\{TILE_FACE \* 0\.28\}>\s*<Avatar [^>]*size=\{TILE_FACE\}/);
  });

  it("only lands bubbles where motion is welcome, and sits beside the header on a wide screen", () => {
    const css = read("app", "ux", "companion.css");
    const parts = css.split("@media (prefers-reduced-motion: no-preference)");
    const atRest = parts[0] + parts.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
    expect(atRest).not.toMatch(/\.companion-phone[^{]*\{[^}]*animation/);
    expect(css).toMatch(/\.companion-phone-msg\.is-said \.phone-bubble \{\s*animation: chat-in/);
    expect(css).toMatch(/@media \(min-width: 60rem\) \{\s*\.companion-hero \{\s*grid-template-columns: minmax\(0, 1fr\) 20rem;/);
  });
});
