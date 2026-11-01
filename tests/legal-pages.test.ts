// The policy pages of 2026-10-24 (docs/after-dark-legal-review.md "What David prepares to apply"): the rewritten terms and
// privacy notice, /content-policy, /2257, /cancel and /report, the footer links to them, the 18+ gate letting them through,
// and the complaint and takedown form's API (lib/content-reports.ts, /api/content-reports, /api/admin/content-reports).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Statement2257Page from "@/app/2257/page";
import { GET as adminList, POST as adminDecide } from "@/app/api/admin/content-reports/route";
import { POST as postReport } from "@/app/api/content-reports/route";
import CancelPage from "@/app/cancel/page";
import ContentPolicyPage from "@/app/content-policy/page";
import LegalPage from "@/app/legal/page";
import { PRIVACY_HEADINGS, TERMS_HEADINGS } from "@/app/legal/sections";
import PrivacyPage from "@/app/privacy/page";
import ReportPage from "@/app/report/page";
import TermsPage from "@/app/terms/page";
import { middleware } from "@/middleware";
import { deleteAccount, exportAccount } from "@/lib/account";
import { MCP_CALLS_KEEP_DAYS } from "@/lib/agent-analytics";
import { CONTENT_REPORT_LIMITS, dueAt, reportRecipients } from "@/lib/content-reports";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { AFTER_DARK_BLOCKED_US_STATES, GOVERNING_STATE, PROCESSORS } from "@/lib/legal-entity";
import { BASE_URL, startTestDb } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PW = ["legal", "pages", "pass"].join("-");
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from content_reports");
  await t.db.query("delete from rate_hits");
  await t.db.query("delete from admins");
  await t.db.query("delete from email_prefs");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setEmailSenderForTests(null);
});

const render = (page: () => ReactElement) => renderToStaticMarkup(createElement(page));
const strip = (html: string) => html.replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the terms", () => {
  it("name the operator, hold 18+, make an agent's operator responsible, and keep the old promises", () => {
    const html = strip(render(TermsPage));
    expect(html).toMatch(/David Smith, an individual in the United States, trading as Botchelor/);
    expect(html).toMatch(/at least 18/);
    expect(html).toMatch(/Whoever runs an agent is responsible for it/);
    expect(html).toMatch(/refund you in full/);
    expect(html).toMatch(/Points are free/);
    expect(html).toMatch(/no prizes/);
  });

  it("list the banned themes, the licence, AI disclosure and no originality promise", () => {
    const html = strip(render(TermsPage));
    for (const theme of [/suggests a minor/, /without consent/, /incest, including step-family/, /bestiality/, /sexual violence or gore/, /teacher and student/, /age-play/]) {
      expect(html).toMatch(theme);
    }
    expect(html).toMatch(/non-exclusive,\s+royalty-free licence/);
    expect(html).toMatch(/No promise of originality/);
    expect(html).toMatch(/fiction written or drawn by AI models/);
  });

  it("explain the subscription: renews monthly, cancel online, access to the end of the period, a yearly reminder", () => {
    const html = strip(render(TermsPage));
    expect(html).toMatch(/isn't on sale yet/);
    expect(html).toMatch(/renews every month until you cancel/);
    expect(html).toContain('href="/cancel"');
    expect(html).toMatch(/keep access until then/);
    expect(html).toMatch(/at least once a year/i);
    expect(html).toMatch(/don't give refunds or credit for part of a period, except where the law requires it/);
    expect(html).toMatch(/before disputing a charge with your bank/);
  });

  it("say where After Dark isn't offered, text-only in the UK, and no VPNs", () => {
    const html = strip(render(TermsPage));
    for (const state of AFTER_DARK_BLOCKED_US_STATES) expect(html).toContain(state);
    expect(html).toMatch(/France, Italy, Germany, Australia and Brazil/);
    expect(html).toMatch(/the United Kingdom and Japan it's text only/);
    expect(html).toContain("France");
    expect(html).toMatch(/Don't use a VPN/);
  });

  it("carry the protections: as is, the liability cap, indemnity, arbitration with an opt-out, and the governing state", () => {
    const html = strip(render(TermsPage));
    expect(html).toMatch(/“as is” and “as available”/);
    expect(html).toMatch(/greater of <strong>\$50<\/strong> or what you\s+paid us in the 12 months/);
    expect(html).toMatch(/Indemnity/);
    expect(html).toMatch(/Consumer Arbitration Rules/);
    expect(html).toMatch(/No class actions/);
    expect(html).toMatch(/within 30 days/);
    expect(html).toMatch(/small-claims court/);
    expect(html).toContain(`laws of the State of ${GOVERNING_STATE}`);
    expect(html).toMatch(/copyright agent/);
    expect(html).toContain('href="/report"');
  });

  it("have an h2 for every entry in the jump list, and no id used twice on /legal", () => {
    const legal = render(LegalPage);
    const ids = [...legal.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of [...TERMS_HEADINGS, ...PRIVACY_HEADINGS]) expect(ids).toContain(h.id);
  });
});

describe("the privacy notice", () => {
  it("names who's responsible, the legal bases, every processor, and the rights", () => {
    const html = strip(render(PrivacyPage));
    expect(html).toMatch(/is responsible for your data/);
    for (const basis of [/To provide the service you asked for/, /Your consent/, /Our legitimate interests/, /The law/]) expect(html).toMatch(basis);
    for (const who of ["Gemini", "Anthropic", "OpenRouter", "fal.ai", "Venice", "Replicate", "Hive", "Vercel", "Neon", "DigitalOcean", "Bunny", "Stripe", "Segpay", "Verotel", "Resend", "Google Analytics"]) {
      expect(html).toContain(who);
    }
    expect(html).toMatch(/International transfers/);
    expect(html).toMatch(/get a copy/);
  });

  it("treats turn-ons as sensitive, reads location only for the law, and says it doesn't sell or share", () => {
    const html = strip(render(PrivacyPage));
    expect(html).toMatch(/sex life/);
    expect(html).toMatch(/explicitly opted in/);
    expect(html).toMatch(/never your card number/);
    expect(html).toMatch(/country you're in \(and, for After Dark, the US state\)/);
    expect(html).toMatch(/We don't sell your personal information, and we don't share it for cross-context behavioural\s+advertising/);
    expect(html).toMatch(/under 18/);
    expect(html).toContain("bz_sess");
  });

  it("states the agent call log's real retention", () => {
    expect(strip(render(PrivacyPage))).toContain(`The log of an agent's tool calls: ${MCP_CALLS_KEEP_DAYS} days.`);
  });

  it("is dated 1 November 2026, with what changed", () => {
    expect(render(PrivacyPage)).toMatch(/Last updated 1 November 2026\./);
    expect(render(PrivacyPage)).toMatch(/Changed: Analytics names the three events/);
    expect(render(TermsPage)).toMatch(/Last updated 1 November 2026\./);
  });
});

describe("the new policy pages", () => {
  it("/content-policy names the lines, the image check, and how to report", () => {
    const html = strip(render(ContentPolicyPage));
    expect(html).toMatch(/<h1>Content policy<\/h1>/);
    expect(html).toMatch(/Bestiality/);
    expect(html).toMatch(/Every After Dark picture and video/);
    expect(html).toMatch(/discarded/);
    expect(html).toMatch(/Nobody can upload pictures or video/);
    expect(html).toContain('href="/report"');
  });

  it("/2257 says every depiction is AI-generated, so no records are required", () => {
    const html = strip(render(Statement2257Page));
    expect(html).toMatch(/18 U\.S\.C\. 2257 statement/);
    expect(html).toMatch(/wholly generated by\s+artificial intelligence/);
    expect(html).toMatch(/no records are required/);
    expect(html).toMatch(/David Smith/);
  });

  it("/cancel links each processor's own cancel page and the email route", () => {
    vi.stubEnv("CONTACT_EMAIL", "help@botchelor.example");
    const html = render(CancelPage);
    expect(html).toContain(`href="${PROCESSORS.segpay.cancelUrl}"`);
    expect(html).toContain(`href="${PROCESSORS.ccbill.cancelUrl}"`);
    expect(html).toContain(`href="${PROCESSORS.verotel.cancelUrl}"`);
    expect(html).toContain('href="mailto:help@botchelor.example"');
    expect(strip(html)).toMatch(/until the end of the period you've already paid for/);
  });

  it("/report shows the form, the promises, and prefills what's reported", async () => {
    const html = strip(renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ what: "/episodes/abc123" }) })));
    expect(html).toMatch(/<h1>Report a problem<\/h1>/);
    expect(html).toMatch(/Within 48 hours/);
    expect(html).toMatch(/Within 7 business days/);
    expect(html).toContain('value="/episodes/abc123"');
    expect(html).toMatch(/It's an intimate image of me/);
    expect(html).toMatch(/name="website"/); // the honeypot
  });

  it("every policy page renders per request and links the others", () => {
    for (const path of ["terms", "privacy", "legal", "content-policy", "2257", "cancel", "report"]) {
      expect(readFileSync(new URL(`../app/${path}/page.tsx`, import.meta.url), "utf8")).toContain('export const dynamic = "force-dynamic";');
    }
    const html = render(ContentPolicyPage);
    for (const href of ["/terms", "/privacy", "/report", "/cancel", "/2257"]) expect(html).toContain(`href="${href}"`);
  });

  it("the site footer links all of them", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    for (const href of ["/terms", "/privacy", "/legal", "/content-policy", "/report", "/cancel", "/2257"]) expect(layout).toContain(`href="${href}"`);
  });

  it("the 18+ gate lets a person through to the policy pages, and still stops them elsewhere", () => {
    const visit = (path: string) => middleware(new NextRequest(`${BASE_URL}${path}`, { headers: { "user-agent": BROWSER } }));
    for (const path of ["/terms", "/privacy", "/content-policy", "/2257", "/report", "/cancel"]) expect(visit(path).headers.get("location")).toBeNull();
    expect(visit("/watch").headers.get("location")).toMatch(/\/gate/);
  });
});

/* -------------------------------------------------- the report API -------------------------------------------------- */

const send = (body: unknown, opts: { ip?: string; ua?: string; cookie?: string } = {}) =>
  postReport(
    new Request(`${BASE_URL}/api/content-reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": opts.ua ?? BROWSER,
        "x-forwarded-for": opts.ip ?? "203.0.113.7",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const rows = async () => (await t.db.query<Any>("select * from content_reports")).rows;
const admin = (method: "GET" | "POST", body?: unknown, qs = "") => {
  const req = new Request(`${BASE_URL}/api/admin/content-reports${qs}`, {
    method,
    headers: { "content-type": "application/json", "x-frontier-key": PW },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return method === "GET" ? adminList(req) : adminDecide(req);
};

/** A public date between two fresh characters. */
async function episode(): Promise<string> {
  const [a, b, id] = [randomUUID(), randomUUID(), randomUUID()];
  for (const c of [a, b]) {
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ($1, $2, 'Cass Vega', 33, 'A florist.', '["bold","gentle","precise"]'::jsonb, 'Quiet.', 'Fireworks.')`,
      [c, randomUUID()],
    );
  }
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, visibility, revealed_at)
     values ($1, $2, $3, $4, 'A lighthouse bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', 'friends', 'ready', 'public', now())`,
    [id, randomUUID(), a, b],
  );
  return id;
}

describe("POST /api/content-reports", () => {
  it("stores a report, finds the date it names, and promises 48 hours for an intimate image", async () => {
    const ep = await episode();
    const res = await send({ category: "intimate_image", target: `https://botchelor.com/episodes/${ep}`, details: "This looks like me.", email: "Me@Example.com" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, urgent: true, promise: "48 hours" });
    const [row] = await rows();
    expect(row).toMatchObject({ id: body.id, category: "intimate_image", episode_id: ep, details: "This looks like me.", contact_email: "me@example.com", status: "open", flagged: false });
  });

  it("promises 7 business days for the rest, and keeps a report with no email", async () => {
    const res = await send({ category: "copyright", details: "My poem is quoted in a date." });
    expect(await res.json()).toMatchObject({ urgent: false, promise: "7 business days" });
    expect((await rows())[0]).toMatchObject({ category: "copyright", target: null, contact_email: null, episode_id: null });
  });

  it("refuses an empty report, an unknown category and a bad email, and stores nothing", async () => {
    const empty = await send({ category: "other", target: "  ", details: "" });
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toBe("empty_report");
    expect((await send({ category: "spicy", details: "x" })).status).toBe(422);
    expect((await send({ category: "other", details: "x", email: "not an email" })).status).toBe(422);
    expect(await rows()).toHaveLength(0);
  });

  it("thanks a script that fills the honeypot, and stores nothing", async () => {
    const res = await send({ category: "other", details: "Buy now", website: "https://spam.example" });
    expect(res.status).toBe(201);
    expect(await rows()).toHaveLength(0);
  });

  it("rate-limits one connection, however many sessions it uses", async () => {
    for (let i = 0; i < CONTENT_REPORT_LIMITS.perHour; i++) expect((await send({ category: "other", details: `Report ${i}` })).status).toBe(201);
    const over = await send({ category: "other", details: "One more" });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe("too_many_reports");
    expect(await rows()).toHaveLength(CONTENT_REPORT_LIMITS.perHour);
    expect((await send({ category: "other", details: "From elsewhere" }, { ip: "198.51.100.9" })).status).toBe(201);
  });

  it("keeps but flags words the content filter catches, and a pile of links", async () => {
    await send({ category: "minor", details: "A character says she is a teen." });
    await send({ category: "other", details: Array.from({ length: 6 }, (_, i) => `https://x.example/${i}`).join(" ") });
    const flagged = (await rows()).map((r) => [r.category, r.flagged, r.flag_reason]).sort();
    expect(flagged).toEqual([["minor", true, "minor"], ["other", true, "links"]]);
  });

  it("emails the contact address and confirmed admins, and our own checks email nobody", async () => {
    const sent: EmailMessage[] = [];
    setEmailSenderForTests(async (m) => void sent.push(m));
    vi.stubEnv("RESEND_API_KEY", "plain-words-not-a-key");
    vi.stubEnv("CONTACT_EMAIL", "help@botchelor.example");
    await t.db.query(`insert into admins (user_id) values ('admin-1'), ('admin-2')`);
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ('admin-1', 'a1@botchelor.example', 'on', now()), ('admin-2', 'a2@botchelor.example', 'pending', null)`);
    expect((await reportRecipients(t.db)).map((r) => r.email)).toEqual(["help@botchelor.example", "a1@botchelor.example"]);

    await send({ category: "real_person", target: "/characters/xyz", details: "This is my neighbour." });
    expect(sent.map((m) => m.to).sort()).toEqual(["a1@botchelor.example", "help@botchelor.example"]);
    expect(sent[0].subject).toMatch(/^\[48 hours\] Report: It's about a real person/);
    expect(sent[0].text).toContain("This is my neighbour.");

    sent.length = 0;
    await send({ category: "other", details: "A check." }, { ua: "botchelor-live-check" });
    expect(sent).toHaveLength(0);
    expect(await rows()).toHaveLength(2);
  });
});

describe("the admin's list and decisions", () => {
  it("needs the admin password or an admin account", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const res = await adminList(new Request(`${BASE_URL}/api/admin/content-reports`));
    expect(res.status).toBe(403);
  });

  it("lists open reports urgent first, hides the date one names, and resolves or dismisses the rest", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const ep = await episode();
    await send({ category: "copyright", details: "Mine." });
    await send({ category: "minor", target: ep, details: "Reads young." });
    const listed = (await (await admin("GET")).json()).reports;
    expect(listed.map((r: Any) => r.category)).toEqual(["minor", "copyright"]);
    expect(listed[0]).toMatchObject({ urgent: true, episode_id: ep, status: "open" });

    // Hiding needs a date: the copyright report names none.
    expect((await admin("POST", { id: listed[1].id, decision: "hidden" })).status).toBe(422);
    expect((await admin("POST", { id: listed[0].id, decision: "hidden", note: "Taken down." })).status).toBe(200);
    expect((await t.db.query<Any>(`select visibility from episodes where id = $1`, [ep])).rows[0].visibility).toBe("private");
    expect((await admin("POST", { id: listed[1].id, decision: "dismissed" })).status).toBe(200);
    expect((await admin("POST", { id: "nope", decision: "resolved" })).status).toBe(404);

    expect((await (await admin("GET")).json()).reports).toEqual([]);
    const all = (await (await admin("GET", undefined, "?status=all")).json()).reports;
    expect(all.map((r: Any) => r.status).sort()).toEqual(["dismissed", "hidden"]);
    expect(all.find((r: Any) => r.status === "hidden").note).toBe("Taken down.");
  });
});

describe("a reporter's account", () => {
  it("exports their reports, and deleting the account forgets them but keeps the report", async () => {
    const me = randomUUID();
    await send({ category: "other", details: "Something odd.", email: "me@example.com" }, { cookie: `bz_uid=${me}` });
    expect((await exportAccount(t.db, me)).content_reports).toEqual([expect.objectContaining({ category: "other", details: "Something odd.", contact_email: "me@example.com" })]);
    await deleteAccount(t.db, me);
    const [row] = await rows();
    expect(row).toMatchObject({ reporter_id: null, contact_email: null, details: "Something odd." });
  });
});

describe("dueAt", () => {
  it("is 48 hours for the urgent kinds and 7 business days (weekends skipped) for the rest", () => {
    const friday = new Date("2026-10-23T12:00:00Z");
    expect(dueAt(friday, "intimate_image").toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(dueAt(friday, "copyright").toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });
});

import AboutPage from "@/app/about/page";
import { PUBLIC_PATHS } from "@/lib/site";

describe("/about, how it's built", () => {
  it("names the stack, links home, and is in the sitemap", () => {
    const html = renderToStaticMarkup(createElement(AboutPage));
    for (const name of ["Next.js 16", "DigitalOcean App Platform", "Cloudflare", "Neon Postgres", "Claude Haiku 5.5", "Hive", "Model Context Protocol"]) expect(html).toContain(name);
    expect(html).toContain('href="/agents"');
    expect(PUBLIC_PATHS).toContain("/about");
  });
});
