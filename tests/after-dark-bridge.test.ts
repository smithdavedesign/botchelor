// The After Dark bridge (2026-11-15): one quiet line on the creator's verdict card when their own character's date ended
// in a second date, to the invite request that already exists, carrying source=verdict. Who sees it (ending, 18+,
// region, the switch), the source saved and counted where the owner reviews invites, and nothing explicit in the copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/episodes/x",
}));
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import AfterDarkSubscribe from "@/app/after-dark/subscribe/page";
import { POST as askForInvite } from "@/app/api/after-dark/invite/route";
import AfterDarkBridge from "@/app/episodes/[id]/AfterDarkBridge";
import VerdictCard from "@/app/episodes/[id]/VerdictCard";
import InviteReview from "@/app/invites/review/page";
import { adBridgeOn, BRIDGE_COPY, bridgeShows, invitePath, inviteSource, SOURCE_MAX, VERDICT_SOURCE, type BridgeFacts } from "@/lib/adult/bridge";
import { viewerBridge } from "@/lib/adult/bridge-viewer";
import { getInvite, inviteSourceCounts, requestInvite, signReviewToken, sourceLabel } from "@/lib/adult/invites";
import { claimAdmin } from "@/lib/admins";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { setPlaceForTests } from "@/lib/place";
import { checkFields } from "@/lib/safety";
import { jsonRequest, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("lib/adult/bridge: the rule, the source and the copy (pure)", () => {
  const SHOWS: BridgeFacts = { on: true, available: true, inviteOnly: true, ending: "second_date", attested: true, mode: "open", entitled: false, asked: false, bot: false };

  it("shows only when every condition holds", () => {
    expect(bridgeShows(SHOWS)).toBe(true);
    // Text-only places are allowed places: After Dark's scenes open there.
    expect(bridgeShows({ ...SHOWS, mode: "text_only" })).toBe(true);
    const off: Partial<BridgeFacts>[] = [
      { on: false }, // AD_BRIDGE=0
      { available: false }, // After Dark is off altogether
      { inviteOnly: false }, // a processor is set up: "invite only" would be untrue
      { ending: "friends" },
      { ending: "disaster" },
      { ending: null },
      { attested: false }, // hasn't said 18 or older
      { mode: "blocked" }, // not offered where they are: nothing says it exists
      { entitled: true }, // already in
      { asked: true }, // already asked
      { bot: true },
    ];
    for (const change of off) expect(bridgeShows({ ...SHOWS, ...change }), JSON.stringify(change)).toBe(false);
  });

  it("AD_BRIDGE=0 turns it off; unset, or anything else, leaves it on", () => {
    expect(adBridgeOn({})).toBe(true);
    expect(adBridgeOn({ AD_BRIDGE: "1" })).toBe(true);
    expect(adBridgeOn({ AD_BRIDGE: "0" })).toBe(false);
    expect(adBridgeOn({ AD_BRIDGE: " 0 " })).toBe(false);
  });

  it("keeps a source only as a short clean label", () => {
    expect(inviteSource("verdict")).toBe("verdict");
    expect(inviteSource(" Refugees ")).toBe("refugees");
    expect(inviteSource("cai_rescue-2")).toBe("cai_rescue-2");
    expect(inviteSource(["refugees", "x"])).toBe("refugees");
    for (const bad of ["", " ", "two words", "<script>", "https://spam.example", "a/b", "-lead", "x".repeat(SOURCE_MAX + 1), 7, null, undefined, {}]) {
      expect(inviteSource(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(invitePath("verdict")).toBe("/after-dark/subscribe?source=verdict");
    expect(invitePath(null)).toBe("/after-dark/subscribe");
    expect(VERDICT_SOURCE).toBe("verdict");
  });

  it("says one clean line: After Dark by name, invite only, nothing explicit", () => {
    const line = `${BRIDGE_COPY.lead} ${BRIDGE_COPY.invite} ${BRIDGE_COPY.link}.`;
    expect(line).toBe("What happened after is After Dark. It's invite only: ask for an invite.");
    // The show's own content filter passes it, and it carries none of the words the adult side uses.
    expect(checkFields({ line }).ok).toBe(true);
    expect(line).not.toMatch(/sex|nsfw|nude|naked|explicit|uncensor|spic|steam|hot|xxx|porn|erotic|adult|18\+|kink|lust|bed|strip/i);
    expect(line).not.toMatch(/free|unlock|subscribe|\$|price|pay/i);
    const out = renderToStaticMarkup(createElement(AfterDarkBridge, { href: "/after-dark/subscribe?source=verdict" })).replace(/&#x27;/g, "'");
    expect(out).toBe(
      '<p class="muted small verdict-after-dark" data-ad-bridge="true">What happened after is After Dark. It\'s invite only: <a href="/after-dark/subscribe?source=verdict" data-track="ad-bridge">ask for an invite</a>.</p>',
    );
    // A line, never a button or a picture.
    expect(out).not.toMatch(/<button|<img|class="[^"]*button/);
  });
});

describe("the verdict card carries the line only when it's handed one", () => {
  const you = { id: "c1", name: "Ilse Varga", hue: 20, house: false, portrait: null };
  const partner = { id: "c2", name: "Barnaby Finch", hue: 200, house: true, portrait: null };
  const card = (afterDark?: { href: string } | null) =>
    renderToStaticMarkup(
      createElement(VerdictCard, { episodeId: "e1", endingLabel: "A second date", you, partner, preview: null, pushKey: null, onRestart: () => {}, ...(afterDark === undefined ? {} : { afterDark }) } as never),
    );

  it("after the share, as the card's last and quietest line", () => {
    const withLine = card({ href: "/after-dark/subscribe?source=verdict" });
    expect(withLine).toContain("data-ad-bridge");
    expect(withLine).toContain('href="/after-dark/subscribe?source=verdict"');
    expect(withLine.indexOf("Hear from Ilse")).toBeLessThan(withLine.indexOf("data-ad-bridge"));
    expect(withLine.indexOf("Watch again")).toBeLessThan(withLine.indexOf("data-ad-bridge"));
    expect(card()).not.toContain("data-ad-bridge");
    expect(card(null)).not.toContain("After Dark");
  });

  it("is wired by the ending: the finished page sends it for a second date, the live stage checks the ending itself", () => {
    expect(source("app/episodes/[id]/page.tsx")).toContain('afterDark: episode.ending === "second_date" ? adBridge : null,');
    expect(source("app/episodes/[id]/page.tsx")).toContain('viewerBridge(db, auth, h, cookieStore.get(ADULT_COOKIE)?.value === "1")');
    expect(source("app/episodes/[id]/GeneratingPoller.tsx")).toContain('afterDark={final === "second_date" ? (stage.verdict.afterDark ?? null) : null}');
    expect(source("app/episodes/[id]/EpisodeTheater.tsx")).toContain("afterDark={verdict.afterDark ?? null}");
    // Its own component: the card holds one line for it.
    expect(source("app/episodes/[id]/VerdictCard.tsx").match(/<AfterDarkBridge /g)).toHaveLength(1);
    expect(source("app/episodes/[id]/VerdictCard.tsx")).toContain("{afterDark && <AfterDarkBridge href={afterDark.href} />}");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let sent: EmailMessage[];
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("RESEND_API_KEY", ["re", "test", "bridge", "key"].join("_"));
  vi.stubEnv("CONTACT_EMAIL", "operator@example.com");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setPlaceForTests({ country: "CA", region: "ON" });
});
afterEach(() => {
  setEmailSenderForTests(null);
  setPlaceForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const BROWSER = new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
/** A signed-in person with a confirmed email. */
async function person(email = "ada@example.com") {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, $2, 'on', now())`, [id, email]);
  return { id, cookie: signedInCookie(id), auth: { userId: id, authenticated: true } };
}
const ask = (cookie: string, body: Record<string, unknown>) => askForInvite(jsonRequest("/api/after-dark/invite", { adult: true, terms: true, ...body }, { cookie }));

describe("who sees the line (lib/adult/bridge-viewer.ts)", () => {
  const LINK = { href: "/after-dark/subscribe?source=verdict" };

  it("someone who has said they're 18 or older, where After Dark is allowed, signed in or not", async () => {
    const me = await person();
    expect(await viewerBridge(t.db, me.auth, BROWSER, true)).toEqual(LINK);
    expect(await viewerBridge(t.db, null, BROWSER, true)).toEqual(LINK);
    expect(await viewerBridge(t.db, { userId: userIdOf(newUserCookie()), authenticated: false }, BROWSER, true)).toEqual(LINK);
    // A text-only place is an allowed place.
    setPlaceForTests({ country: "JP", region: null });
    expect(await viewerBridge(t.db, me.auth, BROWSER, true)).toEqual(LINK);
  });

  it("nobody who hasn't said they're 18 or older, and no crawler or agent", async () => {
    const me = await person();
    expect(await viewerBridge(t.db, me.auth, BROWSER, false)).toBeNull();
    expect(await viewerBridge(t.db, me.auth, new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), true)).toBeNull();
    expect(await viewerBridge(t.db, me.auth, new Headers({ "user-agent": "ClaudeBot/1.0" }), true)).toBeNull();
  });

  it("never where After Dark is blocked, or where the place is unknown", async () => {
    const me = await person();
    for (const where of [{ country: "US", region: "TX" }, { country: "FR", region: null }, { country: null, region: null }, { country: "US", region: null }]) {
      setPlaceForTests(where);
      expect(await viewerBridge(t.db, me.auth, BROWSER, true), JSON.stringify(where)).toBeNull();
      expect(await viewerBridge(t.db, null, BROWSER, true), JSON.stringify(where)).toBeNull();
    }
  });

  it("AD_BRIDGE=0 turns it off, and so does After Dark being off, or a payment processor being set up", async () => {
    const me = await person();
    expect(await viewerBridge(t.db, me.auth, BROWSER, true, { ...process.env, AD_BRIDGE: "0" })).toBeNull();
    vi.stubEnv("AD_BRIDGE", "0");
    expect(await viewerBridge(t.db, me.auth, BROWSER, true)).toBeNull();
    vi.stubEnv("AD_BRIDGE", "");
    expect(await viewerBridge(t.db, me.auth, BROWSER, true)).toEqual(LINK);
    // After Dark off altogether.
    expect(await viewerBridge(t.db, me.auth, BROWSER, true, { ...process.env, ADULT_MODE: "" })).toBeNull();
    // Subscriptions live: the page it leads to sells one, so "invite only" would be untrue.
    const ccbill = { CCBILL_ACCOUNT: "900000", CCBILL_SUBACCOUNT: "0001", CCBILL_FLEX_ID: "flex-1", CCBILL_SALT: "salt", CCBILL_WEBHOOK_KEY: "k".repeat(32) };
    expect(await viewerBridge(t.db, me.auth, BROWSER, true, { ...process.env, ...ccbill })).toBeNull();
  });

  it("not someone already in (an admin, a pass), and not someone who has already asked", async () => {
    const admin = await person("boss@example.com");
    await claimAdmin(t.db, admin.id);
    expect(await viewerBridge(t.db, admin.auth, BROWSER, true)).toBeNull();
    const member = await person("bo@example.com");
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [member.id]);
    expect(await viewerBridge(t.db, member.auth, BROWSER, true)).toBeNull();
    const asked = await person("cy@example.com");
    expect(await viewerBridge(t.db, asked.auth, BROWSER, true)).toEqual(LINK);
    await requestInvite(t.db, asked.id, { email: "cy@example.com", note: null, country: "CA", source: "verdict" });
    expect(await viewerBridge(t.db, asked.auth, BROWSER, true)).toBeNull();
  });
});

describe("the source is saved with the request and counted where the owner reviews", () => {
  it("the invite request keeps a clean source, drops a bad one, and the owner's email says where it came from", async () => {
    const a = await person("ada@example.com");
    expect((await ask(a.cookie, { source: "verdict" })).status).toBe(200);
    expect((await getInvite(t.db, a.id))!.source).toBe("verdict");
    // The operator's copy of each request (an admin with a confirmed address gets one too).
    const mail = () => sent.filter((m) => m.to === "operator@example.com");
    expect(mail()[0]!.text).toContain("Came from: verdict");
    const b = await person("bo@example.com");
    expect((await ask(b.cookie, { source: "<b>not a label</b>" })).status).toBe(200);
    expect((await getInvite(t.db, b.id))!.source).toBeNull();
    expect(mail()[1]!.subject).toBe("After Dark invite request: bo@example.com");
    expect(mail()[1]!.text).toContain("Came from: no source");
    const c = await person("cy@example.com");
    expect((await ask(c.cookie, {})).status).toBe(200);
    expect((await getInvite(t.db, c.id))!.source).toBeNull();
    // Still one request a person, still pending until the owner decides: a source approves nobody.
    expect((await ask(a.cookie, { source: "refugees" })).status).toBe(200);
    expect(await getInvite(t.db, a.id)).toMatchObject({ source: "verdict", status: "pending" });
    expect((await t.db.query(`select 1 from adult_entitlements where subscription_status = 'active'`)).rows).toHaveLength(0);
  });

  it("counts requests by source, most first, with how many wait", async () => {
    const people = await Promise.all(["a", "b", "c", "d", "e", "f"].map((n) => person(`${n}@example.com`)));
    const sources = ["verdict", "verdict", "verdict", "refugees", "refugees", null];
    for (const [i, p] of people.entries()) await requestInvite(t.db, p.id, { email: `${i}@example.com`, note: null, country: "CA", source: sources[i] });
    await t.db.query(`update adult_invites set status = 'approved', decided_at = now() where user_id = $1`, [people[0].id]);
    await t.db.query(`update adult_invites set status = 'declined', decided_at = now() where user_id = $1`, [people[3].id]);
    expect(await inviteSourceCounts(t.db)).toEqual([
      { source: "verdict", requests: 3, pending: 2, approved: 1 },
      { source: "refugees", requests: 2, pending: 1, approved: 0 },
      { source: null, requests: 1, pending: 1, approved: 0 },
    ]);
    expect(sourceLabel(null)).toBe("no source");

    const page = await html(await InviteReview({ searchParams: Promise.resolve({ t: signReviewToken(people[1].id)! }) }));
    expect(page).toContain("<li data-invite-source=\"true\">Came from: verdict</li>");
    expect(page).toContain("Requests so far, by where they came from: verdict 3 (2 waiting) · refugees 2 (1 waiting) · no source 1 (1 waiting).");
    // The decision is still two buttons the owner presses.
    expect(page).toContain('value="approve"');
    expect(page).toContain('value="decline"');
  });

  it("the subscribe page carries ?source= through the sign-in and into the form", async () => {
    const signedOut = await html(await AfterDarkSubscribe({ searchParams: Promise.resolve({ source: "refugees" }) }));
    expect(signedOut).toContain(`href="/account?next=${encodeURIComponent("/after-dark/subscribe?source=refugees")}"`);
    const plain = await html(await AfterDarkSubscribe({ searchParams: Promise.resolve({}) }));
    expect(plain).toContain(`href="/account?next=${encodeURIComponent("/after-dark/subscribe")}"`);
    const junk = await html(await AfterDarkSubscribe({ searchParams: Promise.resolve({ source: "not a label" }) }));
    expect(junk).toContain(`href="/account?next=${encodeURIComponent("/after-dark/subscribe")}"`);

    const me = await person();
    const c = signedInCookie(me.id);
    jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1).split(";")[0]);
    const signedIn = await html(await AfterDarkSubscribe({ searchParams: Promise.resolve({ source: "verdict" }) }));
    expect(signedIn).toMatch(/<form[^>]*data-invite-form="true"[^>]*data-invite-source="verdict"/);
    const noSource = await html(await AfterDarkSubscribe({ searchParams: Promise.resolve({}) }));
    expect(noSource).toMatch(/<form[^>]*data-invite-form="true"/);
    expect(noSource).not.toContain("data-invite-source");
  });
});
