/**
 * Small layout bugs on everyday phone screens (2026-11-20 mobile audit, item 7: B2, B3, B1, C5, C12).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SwitchCharacter from "@/app/SwitchCharacter";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("mobile layout bugs", () => {
  it("B2: the name and its 's stay on one line", () => {
    const html = renderToStaticMarkup(createElement(SwitchCharacter, { name: "Marlowe", suffix: "'s" }));
    expect(html).toMatch(/^<span class="heading-switch-keep"><button[^>]*class="heading-switch"[^>]*>Marlowe<\/button>&#x27;s<\/span>$/);
    expect(read("app/ux/chrome.css")).toMatch(/\.heading-switch-keep \{\s*white-space: nowrap;/);
    expect(read("app/matches/page.tsx")).toContain(`<SwitchCharacter name={first} suffix="'s" /> matches`);
    expect(read("app/studio/page.tsx")).toContain(`<SwitchCharacter name={c.name} suffix="'s" />`);
    // Without a suffix it's the bare button, as before.
    expect(renderToStaticMarkup(createElement(SwitchCharacter, { name: "Marlowe" }))).toMatch(/^<button/);
  });

  it("B3: chat rows put New match on the preview line, and a pair's row drops its kind on a phone", () => {
    const chat = read("app/chat/page.tsx");
    const top = chat.slice(chat.indexOf('className="matches-row-top"'), chat.indexOf('className="matches-row-preview"'));
    expect(top).not.toContain("matches-new");
    expect(chat.slice(chat.indexOf('className="matches-row-preview"'))).toContain("New match");
    expect(read("app/ux/chrome.css")).toMatch(/\.chat-faces\.is-pair \+ \.matches-row-body \.chat-kind \{\s*display: none;/);
  });

  it("B1: the swipe bar's picker hangs from the whole bar, never past the screen", () => {
    expect(read("app/ux/chrome.css")).toMatch(/\.swipe-topbar > \.char-picker--bar \.char-picker-menu \{[^}]*left: 0;[^}]*right: 0;[^}]*transform: none;/);
  });

  it("C5: Make more fills the ⋯ sheet", () => {
    expect(read("app/ux/after-dark.css")).toMatch(/\.theater-tools\.ad-sheet-mode \.ad-make-more\.open \.ad-make-items \{[^}]*width: 100%;/);
  });

  it("C12: no After Dark veil over an empty reel feed", () => {
    expect(read("app/showcase/reels/ReelFeed.tsx")).toContain("{!shown && feed.length > 0 && (");
  });
});
