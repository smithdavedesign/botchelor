import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompanionChat from "@/app/companion/[id]/CompanionChat";

// A client component outside the app router: the router it asks for (to leave after a delete) is a stub here.
vi.mock("next/navigation", async (original) => ({ ...((await original()) as object), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/companion/t1" }));
import type { CompanionAllowance } from "@/lib/companion-plan";
import type { CompanionThreadView } from "@/lib/companion-shared";

/**
 * The companion chat as an app screen (2026-11-13 design lift): who they are beside the thread, their portrait as the
 * wash behind it, their week under the header on a phone, voice notes as pills. Nothing of the thread went away.
 */
const view: CompanionThreadView = {
  id: "t1",
  character: { id: "c1", name: "Ambrose Fenn", portrait: "/api/assets/abc", hue: 200, house: false, yours: false, pronouns: "he/him" },
  messages: [
    { id: "m0", role: "system", text: "Ambrose is an AI character, not a real person.", at: "2026-11-13T00:00:00Z", action: null, marker: null, roleplay: null, voice: null, scene: false },
    { id: "m1", role: "character", text: "Hello. Sorry. I was in the middle of a chapter.", at: "2026-11-13T00:00:01Z", action: null, marker: null, roleplay: null, voice: null, scene: false },
    { id: "m2", role: "user", text: "Which book?", at: "2026-11-13T00:00:02Z", action: null, marker: null, roleplay: null, voice: null, scene: false },
    { id: "m3", role: "character", text: "The one you'd pretend you've read.", at: "2026-11-13T00:00:03Z", action: null, marker: null, roleplay: null, voice: "/api/companion/t1/voice/m3", scene: false },
  ] as unknown as CompanionThreadView["messages"],
  reply_length: "normal",
  scene: null,
  roleplay: null,
  paused: false,
  facts: 3,
};
const allowance = { unlimited: false, left: 12, per_day: 30, resets_at: "2026-11-14T00:00:00Z", guest: false, plan: "none", on_sale: true, price: "$9 a month" } as unknown as CompanionAllowance;
const extras = { voice: { free: false, included_left: null, credits: 0, tokens: 1, bundle: 5 }, minute: null } as unknown as NonNullable<Parameters<typeof CompanionChat>[0]["initialExtras"]>;

const render = (about: Parameters<typeof CompanionChat>[0]["about"]) =>
  renderToStaticMarkup(createElement(CompanionChat, { initial: view, initialCrisis: null, initialAllowance: allowance, initialExtras: extras, signedIn: true, about }));

describe("the companion chat as an app screen", () => {
  const html = render({ job: "Night librarian", hook: "Runs a 24-hour library for insomniac poets.", week: "Lost a bet to Nell and has to read poetry aloud on Friday." });

  it("is the full screen, with their portrait as the wash and a panel that says who they are", () => {
    expect(html).toContain('class="companion-chat companion-fullscreen"');
    expect(html).toContain("--companion-portrait:url(&quot;/api/assets/abc.webp?w=640&quot;)");
    expect(html).toContain('class="companion-side"');
    expect(html).toContain('class="companion-side-portrait"');
    expect(html).toContain("Night librarian");
    expect(html).toContain("Runs a 24-hour library for insomniac poets.");
    expect(html).toContain("This week on the show");
    expect(html).toContain('href="/companion/t1/memory"');
    expect(html).toContain('href="/characters/c1"');
  });

  it("says their week in one line under the header too (for a phone, where the panel is away)", () => {
    expect(html).toContain('class="companion-week"');
    expect(html).toContain("Lost a bet to Nell");
  });

  it("keeps the thread whole: the header's tools, faces at 36px, voice notes as pills, Report, the composer", () => {
    expect(html).toContain('class="companion-head"');
    expect(html).toContain("Settings");
    expect(html).toContain('width="36"');
    expect(html).not.toContain('width="28"');
    expect(html).toContain('class="button-ghost small companion-voice-note"');
    expect(html).toContain("▶ Voice note");
    expect(html).toContain("🔊 Voice note");
    expect(html).toContain("Report");
    expect(html).toContain('id="companion-line"');
    expect(html).toContain("12 free replies left today");
  });

  it("renders the thread alone when nobody says who they are (older callers)", () => {
    const bare = render(null);
    expect(bare).toContain('class="companion-side"');
    expect(bare).not.toContain("This week");
    expect(bare).not.toContain('class="companion-week"');
  });
});
