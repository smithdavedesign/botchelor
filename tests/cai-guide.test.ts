// "How to save your Character.AI characters and chats" (app/guides/save-character-ai, lib/cai-guide.ts, 2026-11-23): four
// steps in Character.AI's own words, each quote exact and beside its source on Character.AI's own sites, a sale box that
// hides itself, the FAQ and its structured data word for word, one loud button, and CAI_GUIDE=0 taking it all away.
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ notFound: 0 }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    nav.notFound++;
    throw new Error("NEXT_NOT_FOUND");
  },
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AlternativePage from "@/app/alternatives/AlternativePage";
import CaiGuide from "@/app/guides/save-character-ai/CaiGuide";
import GuidePage, { metadata } from "@/app/guides/save-character-ai/page";
import ImportPage from "@/app/import/page";
import { alternativeBySlug } from "@/lib/alternatives";
import { llmsText } from "@/lib/agents";
import { CAI_GUIDE_PATH, CAI_HOSTS, CAI_QUOTES, CAI_SOURCES, caiGuideFaq, caiGuideOn } from "@/lib/cai-guide";
import { CAI_SOURCE, IMPORT_CAI_PATH } from "@/lib/import-character";
import { LANDING_CHANGES } from "@/lib/landing-changes";
import { landingPaths, staticSitemap } from "@/lib/seo";

afterEach(() => {
  vi.unstubAllEnvs();
  nav.notFound = 0;
});

const unescape = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (now: Date, history = true) => unescape(renderToStaticMarkup(createElement(CaiGuide, { now, history })));
/** What a reader sees: the markup without the structured data, tags or runs of space. */
const visible = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
const jsonLd = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]) as Record<string, unknown>[];

const BEFORE = new Date("2026-11-30T12:00:00Z");
const AFTER = new Date("2026-12-06T12:00:00Z");

/** Character.AI's words as they were read on 2026-11-23, copied from its pages: the module's quotes must be these. */
const FACTS: Record<keyof typeof CAI_QUOTES, string> = {
  exportTime: "exports can take 3-4 weeks to process",
  exportLink: "The link will be valid for 7 days from the time the email is sent",
  privacyRequest: "To request access to and/or a copy of certain information we hold about you (including in a portable and/or machine-readable format)",
  fieldsVisible: "Tagline and Description are visible to users; the Character Definition is optionally visible.",
  definitionSpecs: "Specs: 0–32,000 characters",
  chatsPrivate: "Creators can never see the conversations that you have with their Characters.",
  upAndRunning: "The Character.ai platform remains up and running, and you can continue to access all services at this time.",
  woundDown: "If such a bid is unavailable, however, the platform will be wound down.",
  privacyUnchanged: "Your information continues to be protected under our Privacy Policy, and our data privacy and security practices are unchanged.",
  subscriptions: "your subscriptions remain active… we intend to notify subscribers in advance.",
};

describe("the guide", () => {
  it("renders the four steps, in order", () => {
    const html = render(BEFORE);
    const steps = /<ol class="import-how-list cai-guide-steps">([\s\S]*?)<\/ol>/.exec(html)![1];
    const heads = [...steps.matchAll(/<li><strong>(.*?)<\/strong>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      "Request your data export today.",
      "Copy each character you made.",
      "Save the chats you care about.",
      "Bring them somewhere.",
    ]);
    const text = visible(html);
    expect(text).toContain("Profile → Profile Settings → Account → Manage Account & Data → Export Data");
    expect(text).toContain("Profile → Settings icon → Legal & Privacy → Export Data");
    expect(text).toContain("doesn't say what the export holds");
    expect(text).toContain("Select the text and copy it into a document.");
  });

  it("quotes Character.AI exactly, every quote on the page", () => {
    expect(CAI_QUOTES).toEqual(FACTS);
    const text = visible(render(BEFORE));
    for (const words of Object.values(FACTS)) expect(text, words).toContain(`“${words}”`);
  });

  it("links out only to Character.AI's own sites, never followed", () => {
    const html = render(BEFORE);
    const external = [...html.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)];
    expect(external.length).toBeGreaterThanOrEqual(Object.keys(CAI_SOURCES).length);
    for (const [tag, href] of external) {
      expect(CAI_HOSTS, href).toContain(new URL(href).host);
      expect(tag, href).toContain('rel="nofollow noopener"');
    }
    for (const href of Object.values(CAI_SOURCES)) expect(html).toContain(`href="${href}"`);
    // No email address in the markup outside the structured data: Cloudflare's email obfuscation rewrites one and the
    // page fails to hydrate (React #418, docs/company.md); it did on the first deploy.
    expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    // No pictures of Character.AI: the set behind the hero is the page's only image, and it's ours.
    expect([...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]).every((src) => src.startsWith("/"))).toBe(true);
  });

  it("shows the sale box on 2026-11-30 and hides it from 2026-12-06; the steps stay", () => {
    const before = render(BEFORE);
    expect(before).toContain("What Character.AI has said");
    expect(before).toContain(CAI_SOURCES.saleNotice);
    expect(visible(before)).toContain("bids due November 24 at 12:00 ET, an auction on December 1 at 10:00 ET, and a sale hearing on December 3–4 at 9:30 ET");
    const after = render(AFTER);
    expect(after).not.toContain("What Character.AI has said");
    expect(after).not.toContain(FACTS.woundDown);
    expect(after).not.toContain(CAI_SOURCES.saleNotice);
    expect(after).not.toContain("auction");
    expect(after).toContain("Request your data export today.");
    expect(visible(after)).toContain(FACTS.exportTime);
  });

  it("gives the FAQ's structured data word for word as the page shows it", () => {
    for (const history of [true, false]) {
      const html = render(BEFORE, history);
      const faq = jsonLd(html).find((d) => d["@type"] === "FAQPage") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
      const shown = [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => ({ q: m[1], a: m[2] }));
      expect(shown).toEqual(caiGuideFaq(history));
      expect(faq.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text }))).toEqual(shown);
      expect(shown.map((s) => s.q)).toEqual([
        "How do I export my Character.AI data?",
        "How long does a Character.AI export take?",
        "Can I copy a character's definition?",
        "Can I move my Character.AI character to another app?",
      ]);
      // Nothing in the FAQ is dated: it stays after the sale box goes.
      expect(faq.mainEntity.map((e) => e.acceptedAnswer.text).join(" ")).not.toMatch(/auction|December|wound/);
    }
  });

  it("speaks of the second box only while /import has it", () => {
    expect(visible(render(BEFORE, true))).toContain("paste a chat in the second box so they remember it");
    const without = visible(render(BEFORE, false));
    expect(without).not.toContain("second box");
    expect(without).not.toMatch(/history/i);
  });

  it("has one loud button, and it brings a character over through the Character.AI door", () => {
    const html = render(BEFORE);
    const buttons = [...html.matchAll(/<a [^>]*class="button"[^>]*>(.*?)<\/a>/g)];
    expect(buttons).toHaveLength(1);
    expect(buttons[0][0]).toContain(`href="${IMPORT_CAI_PATH}"`);
    expect(buttons[0][0]).toContain('data-track="alternative-import"');
    expect(buttons[0][0]).toContain('data-track-src="guide"');
    expect(buttons[0][1]).toBe("Bring a character over");
    expect(html).toMatch(/<p class="kicker">Character\.AI<\/p>/);
    expect(html).toContain("<h1>Save your Character.AI characters and chats</h1>");
  });

  it("never says what it mustn't, before or after the box goes", () => {
    for (const now of [BEFORE, AFTER]) {
      for (const history of [true, false]) {
        const html = render(now, history);
        for (const banned of ["shutting down", "shut down", "better than", "official", "best", "™", "®"]) {
          expect(html.toLowerCase(), banned).not.toContain(banned);
        }
      }
    }
    expect(visible(render(BEFORE))).toContain("Character.AI is a trademark of its owner. Botchelor isn't affiliated with or endorsed by Character.AI.");
  });

  it("has its own title, description and canonical address", () => {
    expect(metadata.title).toBe("How to save your Character.AI characters and chats · Botchelor");
    expect((metadata.title as string).length).toBeLessThanOrEqual(65);
    expect(metadata.description).toMatch(/3–4 weeks/);
    expect((metadata.description as string).length).toBeLessThanOrEqual(155);
    expect(metadata.alternates?.canonical).toBe(CAI_GUIDE_PATH);
  });
});

describe("CAI_GUIDE", () => {
  const alt = alternativeBySlug("character-ai")!;
  // The /alternatives note shows until its own `until` day; render it while it's up.
  const altPage = () => unescape(renderToStaticMarkup(createElement(AlternativePage, { alt, now: new Date("2026-11-24T12:00:00Z") })));
  const importCai = async () => unescape(renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({ from: CAI_SOURCE }) })));

  it("is on by default: the page renders, the two quiet links point to it, and it's in the sitemap and llms.txt", async () => {
    expect(caiGuideOn({})).toBe(true);
    expect(nav.notFound).toBe(0);
    expect(renderToStaticMarkup(GuidePage())).toContain("Save your Character.AI characters and chats");
    expect(altPage()).toContain(`<a href="${CAI_GUIDE_PATH}">How to save your characters and chats first</a>`);
    const imp = await importCai();
    expect(imp).toContain(`href="${CAI_GUIDE_PATH}"`);
    // Both pages keep their one loud button.
    expect([...imp.matchAll(/class="button"/g)].length).toBeLessThanOrEqual(1);
    expect(landingPaths()).toContain(CAI_GUIDE_PATH);
    const entry = staticSitemap("https://botchelor.com", new Date("2026-11-25T00:00:00Z")).find((e) => e.url === `https://botchelor.com${CAI_GUIDE_PATH}`);
    expect(entry?.lastModified).toBe("2026-11-23");
    expect(entry?.priority).toBe(0.8);
    expect(LANDING_CHANGES.some((c) => c.path === CAI_GUIDE_PATH)).toBe(true);
    expect(llmsText("https://botchelor.com")).toContain(CAI_GUIDE_PATH);
  });

  it("=0 makes the page a 404 and takes away both links, the sitemap entry and the llms.txt line", async () => {
    vi.stubEnv("CAI_GUIDE", "0");
    expect(caiGuideOn()).toBe(false);
    expect(() => GuidePage()).toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toBe(1);
    const alternatives = altPage();
    expect(alternatives).toContain("alt-note");
    expect(alternatives).not.toContain(CAI_GUIDE_PATH);
    expect(await importCai()).not.toContain(CAI_GUIDE_PATH);
    expect(landingPaths()).not.toContain(CAI_GUIDE_PATH);
    expect(staticSitemap("https://botchelor.com").some((e) => e.url.endsWith(CAI_GUIDE_PATH))).toBe(false);
    expect(llmsText("https://botchelor.com")).not.toContain(CAI_GUIDE_PATH);
  });
});
