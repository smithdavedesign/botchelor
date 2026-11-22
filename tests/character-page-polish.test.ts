import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NO_DECK_FILTERS } from "@/lib/deck-filters";

// The owner's controls route after a change; a static render only needs a stub router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: OwnerControls } = await import("@/app/characters/[id]/OwnerControls");
const { default: DatePhoto } = await import("@/app/companion/[id]/DatePhoto");
const { default: DeckFilterForm } = await import("@/app/swipe/DeckFilterForm");

// 2026-11-22 audit, a character's page and the swipes around it: a private character said it was in the swipe deck,
// Delete sat two folds deep, an open Share swallowed the next click, the match overlay's email row stretched its icon,
// a date's photo was a dark box while it was composed, and a Studio picture went in one press.
const read = (p: string) => readFileSync(p, "utf8");
const owner = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(OwnerControls, { id: "char-ira-1", name: "Ira Fenn", openToDates: true, ...over } as never));

describe("the owner's controls", () => {
  it("a private character open to dates isn't said to be in the swipe deck, which never deals it", () => {
    const priv = owner({ private: true });
    expect(priv).toContain("💌 Open to dates, but private: they stay out of the swipe deck until you make them public.");
    expect(priv).not.toContain("💌 In the swipe deck");
    // Public, it is in the deck, and says so.
    expect(owner({ private: false })).toContain("💌 In the swipe deck: other creators");
    // The deck's own rule this copy follows.
    expect(read("lib/swipes.ts")).toContain("c.open_to_dates and c.visibility <> 'private'");
  });

  it("Delete is one fold deep: out of Settings, at the foot of the owner's card, and named", () => {
    const html = owner({});
    const settingsEnd = html.indexOf("</details>");
    const danger = html.indexOf('class="owner-danger"');
    expect(settingsEnd).toBeGreaterThan(0);
    expect(danger).toBeGreaterThan(settingsEnd);
    expect(html.slice(danger)).toMatch(/<button type="button" class="link-button danger">Delete Ira<\/button>/);
    // The browser's confirm still asks before anything goes.
    expect(read("app/characters/[id]/OwnerControls.tsx")).toMatch(/async function remove\(\) \{\s*if \(!confirm\(`Delete \$\{props\.name\}\?/);
  });
});

describe("the character page's head", () => {
  const page = read("app/characters/[id]/page.tsx");
  it("the heading holds the name alone, its badges beside it in the same row", () => {
    expect(page).toContain('<div className="contestant-name">\n            <h1>{c.name}</h1>');
    const head = page.slice(page.indexOf('<div className="contestant-name">'), page.indexOf('<p className="muted">\n            Age {c.age}'));
    expect(head).not.toMatch(/<h1>[^<]*\{c\.name\}\s*\{/);
    expect(head).toContain("<OriginBadge origin={origin} />");
    // The row's layout moved from the heading to its wrapper.
    expect(read("app/ux/show.css")).toMatch(/\.contestant \.meta \.contestant-name \{\s*display: flex;/);
    expect(read("app/ux/show.css")).not.toMatch(/\.contestant \.meta h1 \{\s*display: flex;/);
  });

  it("has one way to text them, the header's Text, not a second Talk card", () => {
    expect(page).not.toContain("companion-entry");
    expect(page).not.toContain("label={`Talk to ${shortName(c.name)}`}");
  });
});

describe("Share is a popover, not a modal", () => {
  it("passes modal: false, and the overlay hook leaves the page live for it", () => {
    expect(read("app/ShareButton.tsx")).toMatch(/useOverlay\(open, \{ root: box, onClose: \(\) => setOpen\(false\), modal: false \}\)/);
    const hook = read("app/useOverlay.ts");
    expect(hook).toContain("const release = modal ? inertOutside(el) : () => {};");
    // A popover doesn't stop the page scrolling unless asked, and Tab stays the modal's under it.
    expect(hook).toMatch(/modal = true,\s*lock = modal,/);
    expect(hook).toContain('if (e.key === "Tab" && traps.at(-1) === token) return wrapTab(e, el);');
    // Every other overlay stays modal: none of them opts out.
    for (const p of ["app/CharacterPicker.tsx", "app/couples/[a]/[b]/ThreadMenu.tsx", "app/episodes/[id]/EpisodeTheater.tsx", "app/AgeGate.tsx", "app/companion/[id]/CompanionChat.tsx"]) {
      expect(read(p), p).not.toContain("modal: false");
    }
  });
});

describe("swipes and texts", () => {
  it("every deck filter has a name a screen reader says (a label for each select, in both places it shows)", () => {
    for (const variant of ["intro", "bar"] as const) {
      const html = renderToStaticMarkup(createElement(DeckFilterForm, { characterId: "char-ira-1", filters: NO_DECK_FILTERS, variant }));
      const ids = [...html.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.length).toBe(4);
      for (const id of ids) expect(html, id).toMatch(new RegExp(`<label class="sr-only" for="${id}">[^<]+</label>`));
    }
  });

  it("the match overlay's email row keeps its icon small on a phone: a link action takes the button's place", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/@media \(max-width: 480px\) \{\s*\.invite-row \{\s*grid-template-columns: auto minmax\(0, 1fr\);\s*\}\s*\.invite-row > :is\(button, a\) \{\s*grid-column: 2;/);
    expect(css).toMatch(/\.swipe-match-card \.push-prompt \{[^}]*text-align: left;/);
    // That row's action is a link (PushToggle's Email me).
    expect(read("app/notifications/PushToggle.tsx")).toMatch(/<Link className="button-ghost small" href=\{signedIn \? "\/account#email-notifications" : "\/account"\}>\s*Email me/);
  });

  it("a date's photo shows a light 'Developing…' placeholder under the picture while it's composed", () => {
    const html = renderToStaticMarkup(createElement(DatePhoto, { src: "/api/og/date-photo/ep-1", alt: "Ira and Nell at the pier", href: "/episodes/ep-1" }));
    expect(html).toMatch(/<a class="date-photo-link"[^>]*><span class="sk date-photo-wait" aria-hidden="true">📸 Developing…<\/span><img /);
    const css = read("app/ux/phone.css");
    expect(css).toMatch(/\.date-photo-link \.date-photo-wait \{\s*position: absolute;\s*inset: 0;/);
    expect(css).toMatch(/\.date-photo-link img \{\s*position: relative;\s*\}/);
  });
});

describe("a Studio picture asks before it's deleted", () => {
  it("Delete opens Yes, delete / Keep in the tile; only Yes deletes", () => {
    const src = read("app/characters/[id]/studio/PgStudio.tsx");
    expect(src).not.toContain("onClick={() => onDelete(p.id)}");
    expect(src).toContain('onClick={() => setAsking(p.id)}');
    expect(src).toMatch(/Delete for good\?\{p\.pinned \? " It comes off their profile too\." : ""\}/);
    expect(src).toMatch(/onClick=\{\(\) => \{\s*setAsking\(null\);\s*onDelete\(p\.id\);\s*\}\}/);
    expect(src).toMatch(/onClick=\{\(\) => setAsking\(null\)\}>\s*Keep/);
  });
});
