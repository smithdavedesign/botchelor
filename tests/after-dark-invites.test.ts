import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as askForInvite } from "@/app/api/after-dark/invite/route";
import { POST as review } from "@/app/api/invites/review/route";
import InviteReview from "@/app/invites/review/page";
import { canAfterDark } from "@/lib/adult/entitlement";
import { BETA_DAYS, decideInvite, getInvite, signReviewToken, verifyReviewToken, welcomeEmail } from "@/lib/adult/invites";
import { clipPrice, hasSubscription, includedPrice } from "@/lib/adult/pricing";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { setPlaceForTests } from "@/lib/place";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE_URL, jsonRequest, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// David, 2026-10-31: "Make it invite only, email me and I approve. Free for starters, I'll foot the bill, but not video
// generation, that's on them. Include that in the welcome email."
const KEY = ["re", "test", "invites", "key"].join("_");
const OPERATOR = "operator@example.com";

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
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("CONTACT_EMAIL", OPERATOR);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
  setPlaceForTests({ country: "CA", region: "ON" });
});
afterEach(() => {
  setEmailSenderForTests(null);
  setPlaceForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A signed-in person with a confirmed email. */
async function person(email = "ada@example.com") {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, $2, 'on', now())`, [id, email]);
  return { id, cookie: signedInCookie(id) };
}
const ask = (cookie: string | undefined, body: Record<string, unknown> = { adult: true, terms: true, note: "Big fan of the show" }) =>
  askForInvite(jsonRequest("/api/after-dark/invite", body, { cookie }));
const reviewLink = (msg: EmailMessage) => new URL(/https?:\/\/\S+\/invites\/review\?t=[^\s]+/.exec(msg.text)![0]);
const press = (token: string, action: string) => {
  const form = new FormData();
  form.set("action", action);
  return review(new Request(`${BASE_URL}/api/invites/review?t=${encodeURIComponent(token)}`, { method: "POST", body: form }));
};

describe("asking for an invite", () => {
  it("records the request and the 18+ declaration, and emails the operator a review link", async () => {
    const { id, cookie } = await person();
    const res = await ask(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending" });
    expect(await getInvite(t.db, id)).toMatchObject({ email: "ada@example.com", note: "Big fan of the show", country: "CA", status: "pending" });
    const e = (await t.db.query(`select age_method, age_country, subscription_status from adult_entitlements where user_id = $1`, [id])).rows[0];
    expect(e).toMatchObject({ age_method: "self_declared", age_country: "CA", subscription_status: "none" });
    // Not in yet.
    expect((await canAfterDark(t.db, { userId: id, authenticated: true })).ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: OPERATOR, subject: "After Dark invite request: ada@example.com" });
    expect(sent[0]!.text).toContain("Big fan of the show");
    expect(sent[0]!.text).toContain("video on them");
    const link = reviewLink(sent[0]!);
    expect(link.origin).toBe("https://botchelor.com");
    expect(verifyReviewToken(link.searchParams.get("t"))).toBe(id);
  });

  it("asking again doesn't email twice", async () => {
    const { cookie } = await person();
    await ask(cookie);
    expect(await (await ask(cookie)).json()).toEqual({ status: "pending" });
    expect(sent).toHaveLength(1);
  });

  it("refuses the signed out, missing boxes, blocked places, no email, and someone already in", async () => {
    expect((await ask(newUserCookie())).status).toBe(401);
    const { cookie } = await person();
    expect((await ask(cookie, { adult: true })).status).toBe(422);
    setPlaceForTests({ country: "US", region: "TX" });
    expect((await ask(cookie)).status).toBe(451);
    setPlaceForTests({ country: "CA", region: "ON" });
    const noEmail = userIdOf(newUserCookie());
    const r = await ask(signedInCookie(noEmail));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe("needs_email");
    const member = await person("bo@example.com");
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [member.id]);
    expect((await ask(member.cookie)).status).toBe(409);
    expect(sent).toHaveLength(0);
  });
});

describe("reviewing from the email", () => {
  it("the page shows the request with buttons; Approve gives a beta pass and sends the welcome", async () => {
    const { id, cookie } = await person();
    await ask(cookie);
    const token = reviewLink(sent[0]!).searchParams.get("t")!;
    const page = renderToStaticMarkup(await InviteReview({ searchParams: Promise.resolve({ t: token }) }));
    expect(page).toContain("ada@example.com");
    expect(page).toContain('value="approve"');
    // Opening the page decides nothing.
    expect((await getInvite(t.db, id))!.status).toBe("pending");

    const res = await press(token, "approve");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=approved");
    expect(res.headers.get("location")).toContain("welcomed=1");
    expect(await canAfterDark(t.db, { userId: id, authenticated: true })).toEqual({ ok: true, why: "beta" });
    const end = (await t.db.query<{ period_end: Date }>(`select period_end from adult_entitlements where user_id = $1`, [id])).rows[0]!.period_end;
    expect(Math.round((new Date(end).getTime() - Date.now()) / 86_400_000)).toBe(BETA_DAYS);
    const welcome = sent.find((m) => m.to === "ada@example.com")!;
    expect(welcome.subject).toBe("Your Botchelor invite");
    // Replies go to the operator.
    expect(welcome.replyTo).toBe(OPERATOR);
    expect(welcome.text).toContain("Video isn't included: that one's on you");
    expect(welcome.text).toContain("Each clip costs 1 token and the video of the night 7 tokens");
    expect(welcome.text).toContain("https://botchelor.com/after-dark");
    // Discreet: nothing explicit in the subject.
    expect(welcome.subject).not.toMatch(/after dark|adult|18/i);

    // A second press changes nothing.
    expect((await press(token, "decline")).headers.get("location")).toContain("already=1");
    expect((await getInvite(t.db, id))!.status).toBe("approved");
  });

  it("Decline closes the request and sends nothing to them", async () => {
    const { id, cookie } = await person();
    await ask(cookie);
    const token = reviewLink(sent[0]!).searchParams.get("t")!;
    expect((await press(token, "decline")).headers.get("location")).toContain("done=declined");
    expect((await getInvite(t.db, id))!.status).toBe("declined");
    expect((await canAfterDark(t.db, { userId: id, authenticated: true })).ok).toBe(false);
    expect(sent.filter((m) => m.to === "ada@example.com")).toHaveLength(0);
  });

  it("a forged, expired or missing token does nothing", async () => {
    const { id, cookie } = await person();
    await ask(cookie);
    expect((await press("nope.nope", "approve")).headers.get("location")).toContain("invalid=1");
    const expired = signReviewToken(id, process.env, Date.now() - 40 * 86_400_000)!;
    expect(verifyReviewToken(expired)).toBeNull();
    expect((await press(expired, "approve")).headers.get("location")).toContain("invalid=1");
    vi.stubEnv("SESSION_SECRET", "a-different-secret-for-the-forgery-test");
    expect(verifyReviewToken(signReviewToken(id, { SESSION_SECRET: TEST_SESSION_SECRET }))).toBeNull();
    expect((await getInvite(t.db, id))!.status).toBe("pending");
  });
});

describe("what a beta pass includes", () => {
  it("chapters and pictures on the house; clips always cost tokens", async () => {
    const { id, cookie } = await person();
    await ask(cookie);
    expect((await decideInvite(t.db, id, "approved")).ok).toBe(true);
    expect(await hasSubscription(t.db, id)).toBe(true);
    expect(await includedPrice(t.db, id, 1)).toEqual({ tokens: 0, included: true });
    expect(await clipPrice(t.db, id)).toEqual({ tokens: 1, included: false, included_left: null, included_of: 3 });
  });

  it("lapses after the beta's days", async () => {
    const { id, cookie } = await person();
    await ask(cookie);
    await decideInvite(t.db, id, "approved");
    const later = new Date(Date.now() + (BETA_DAYS + 1) * 86_400_000);
    expect((await canAfterDark(t.db, { userId: id, authenticated: true }, later)).ok).toBe(false);
  });

  it("the welcome names the end date and the shop", () => {
    const m = welcomeEmail({ base: "https://botchelor.com/", until: new Date("2026-11-30T12:00:00Z"), clipTokens: 2, reelTokens: 7 });
    expect(m.text).toContain("free until November 30, 2026");
    expect(m.text).toContain("Each clip costs 2 tokens");
    expect(m.text).toContain("Shop: https://botchelor.com/shop");
  });
});
