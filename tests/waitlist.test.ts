import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LegalPage from "@/app/legal/page";
import WaitlistForm from "@/app/WaitlistForm";
import { cleanRef } from "@/lib/waitlist";
import { api, newUserCookie, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const signup = (overrides: Record<string, unknown> = {}) => ({
  email: "mira@example.com",
  attest: true,
  ...overrides,
});

describe("POST /api/waitlist", () => {
  it("returns 201 {ok: true} and stores the email trimmed and lowercased, with where they roleplay and the ref", async () => {
    const res = await api.joinWaitlist(
      signup({ email: "  Mira.Quell@Example.COM ", community: "  an AI roleplay Discord ", ref: "rp-discord" }),
      newUserCookie(),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const { rows } = await t.db.query("select email, community, ref from waitlist");
    expect(rows).toEqual([{ email: "mira.quell@example.com", community: "an AI roleplay Discord", ref: "rp-discord" }]);
  });

  it("works without a cookie, community or ref, and sets no cookie", async () => {
    const res = await api.joinWaitlist(signup());
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    const { rows } = await t.db.query("select community, ref from waitlist");
    expect(rows).toEqual([{ community: null, ref: null }]);
  });

  it("answers a repeat signup exactly like a new one (no way to probe the list) and stores it once", async () => {
    const first = await api.joinWaitlist(signup({ community: "first" }));
    const again = await api.joinWaitlist(signup({ email: "MIRA@example.com", community: "second" }));
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(await again.json()).toEqual(await first.json());
    const { rows } = await t.db.query("select email, community from waitlist");
    expect(rows).toEqual([{ email: "mira@example.com", community: "first" }]);
  });

  it.each([
    ["no email", { email: undefined }],
    ["a malformed email", { email: "mira-at-example.com" }],
    ["an email over 254 characters", { email: `${"m".repeat(250)}@example.com` }],
    ["no 18+ attestation", { attest: undefined }],
    ["attest: false", { attest: false }],
    ["a community over 80 characters", { community: "c".repeat(81) }],
    ["a ref with spaces", { ref: "rp discord" }],
    ["a ref over 40 characters", { ref: "r".repeat(41) }],
  ])("returns 422 for %s and stores nothing", async (_label, overrides) => {
    const res = await api.joinWaitlist(signup(overrides));
    expect(res.status).toBe(422);
    expect(await t.count("waitlist")).toBe(0);
  });

  it("accepts JSON only", async () => {
    const { POST } = await import("@/app/api/waitlist/route");
    const res = await POST(
      new Request("http://localhost:3000/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=mira%40example.com&attest=true",
      }),
    );
    expect(res.status).toBe(415);
    expect(await t.count("waitlist")).toBe(0);
  });
});

describe("cleanRef", () => {
  it.each([
    ["rp-discord", "rp-discord"],
    ["Reddit_AIRP", "reddit_airp"],
    ["", null],
    [undefined, null],
    ["has space", null],
    ["<script>", null],
    ["r".repeat(41), null],
  ])("turns %j into %j", (input, expected) => {
    expect(cleanRef(input)).toBe(expected);
  });
});

describe("landing page (M3)", () => {
  it("renders the waitlist form with an email field, the 18+ attestation and the ref it came from", () => {
    const html = renderToStaticMarkup(createElement(WaitlistForm, { refSlug: "rp-discord" }));
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/name="attest"/);
    expect(html).toMatch(/18 or older/);
    expect(html).toMatch(/name="community"/);
    expect(html).toContain('value="rp-discord"');
  });

  it("speaks to the AI-friendly roleplay audience and mounts the waitlist on /", () => {
    const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/import WaitlistForm from "\.\/WaitlistForm"/);
    expect(page).toContain("<WaitlistForm");
    expect(page).toMatch(/roleplay/i);
    expect(page).toMatch(/written by AI/i);
    expect(page).toContain("<StartForm");
  });

  it("links the shop and the legal page from the site layout", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('href="/shop"');
    expect(layout).toContain('href="/legal"');
  });
});

describe("legal page (M3)", () => {
  it("covers refunds, points having no value, what is stored and who processes it", () => {
    const html = renderToStaticMarkup(createElement(LegalPage));
    expect(html).toMatch(/refund/i);
    expect(html).toMatch(/Points are free/i);
    expect(html).toMatch(/can(&#x27;|')t be bought/i);
    expect(html).toMatch(/Stripe/);
    expect(html).toMatch(/waitlist/i);
    expect(html).toMatch(/18/);
  });

  it("is rendered per request, so a CONTACT_EMAIL set after the build shows up", async () => {
    const legal = await import("@/app/legal/page");
    expect(legal.dynamic).toBe("force-dynamic");
  });

  it("discloses that the stored Stripe checkout ID links this browser to the Stripe receipt", () => {
    const html = renderToStaticMarkup(createElement(LegalPage));
    expect(html).toMatch(/checkout ID links your purchases in this browser to your Stripe receipt/);
  });

  it("shows the contact address from CONTACT_EMAIL, and says so plainly when it isn't set", () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    expect(renderToStaticMarkup(createElement(LegalPage))).toMatch(/contact address will be posted here/i);
    vi.stubEnv("CONTACT_EMAIL", "help@botchelor.example");
    expect(renderToStaticMarkup(createElement(LegalPage))).toContain('href="mailto:help@botchelor.example"');
  });
});
