import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Connections page and the admin's providers view read the viewer from next/headers: hand them this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KeysPage from "@/app/account/keys/page";
import ConnectionCard from "@/app/account/keys/ConnectionCard";
import ProviderMark from "@/app/account/keys/ProviderMark";
import KeyForm from "@/app/account/keys/KeyForm";
import AfterDarkProvidersPage from "@/app/admin/after-dark/providers/page";
import { registerAccount } from "@/lib/auth";
import { claimAdmin } from "@/lib/admins";
import { saveAdultSettings } from "@/lib/adult/settings";
import { assignJob, recordError, recordUsage, saveConnection } from "@/lib/connections";
import { modelOptions, plainError } from "@/lib/connections-shared";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// /account/keys, Connections (docs/PRDs/connections.md): its signed-out and unavailable states, the job cards in each state,
// the key list (never the key), After Dark's read-only card for an admin, and the admin's providers view.

const U = "dddd4444-0000-4000-8000-000000000004";
const fakeKey = (tag: string) => ["test", "key", "not", "real", tag, "2468"].join("-");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from accounts");
  await t.db.query("delete from admins");
  await t.db.query("delete from adult_privacy");
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  await registerAccount(t.db, U, "pagekeys", ["a", "good", "password"].join("-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const signIn = () => {
  const [name, value] = signedInCookie(U).split("=");
  jar.cookies.set(name, value);
};
const page = async () => renderToStaticMarkup(await KeysPage());

describe("/account/keys: Connections", () => {
  it("signed out: asks you to sign in, and comes back here after", async () => {
    const html = await page();
    expect(html).toContain("<h1>Connections</h1>");
    expect(html).toContain('href="/account?next=%2Faccount%2Fkeys"');
    expect(html).not.toContain("connection-card");
  });

  it("an anonymous cookie gets the same sign-in state", async () => {
    jar.cookies.set("bz_uid", U);
    expect(await page()).toContain('href="/account?next=%2Faccount%2Fkeys"');
  });

  it("says it isn't on here when the deployment can't seal keys", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(await page()).toMatch(/isn(&#x27;|')t enabled on this deployment/);
  });

  it("no keys yet: a card per job on the free model or not set up, and nothing about After Dark", async () => {
    signIn();
    const html = await page();
    for (const title of ["Dates &amp; texts", "Portraits &amp; pictures", "Intro clips"]) expect(html).toContain(title);
    expect(html).toContain("Using: Botchelor&#x27;s free model");
    expect(html).toContain("Not set up: portraits need your own OpenAI key.");
    expect(html).toContain("Not set up: clips need your own Google key, with billing on.");
    expect(html.match(/>Connect</g)).toHaveLength(3);
    expect(html).not.toContain('id="your-keys"');
    expect(html).not.toMatch(/after dark/i);
  });

  it("a working key: its card says so with the model, its last four and when it was checked; the key itself never appears", async () => {
    signIn();
    const key = fakeKey("page");
    await saveConnection(t.db, U, "openrouter", key, { verifiedAt: new Date(Date.now() - 120_000).toISOString() });
    await assignJob(t.db, U, "text", "openrouter", "deepseek/deepseek-chat-v3.1");
    const html = await page();
    expect(html).toContain("Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1 · Lively");
    expect(html).toContain("•••• 2468 · checked 2 min ago · not used yet");
    expect(html).toContain("✓ Connected");
    expect(html).toContain('id="your-keys"');
    expect(html).toContain("used for Dates &amp; texts");
    expect(html).toContain(">Replace<");
    expect(html).toContain(">Remove<");
    expect(html).not.toContain(key);
    const sealed = (await t.db.query<{ ciphertext: string }>(`select ciphertext from user_connections where user_id = $1`, [U])).rows[0].ciphertext;
    expect(html).not.toContain(sealed);
  });

  it("a key in trouble: Needs attention, what went wrong in plain words, and a link to fix it", async () => {
    signIn();
    await saveConnection(t.db, U, "openrouter", fakeKey("dry"));
    await assignJob(t.db, U, "text", "openrouter", null);
    await recordError(t.db, U, "openrouter", "no_credit");
    const html = await page();
    expect(html).toContain("Needs attention");
    expect(html).toContain("OpenRouter: out of credit.");
    expect(html).toContain('href="https://openrouter.ai/settings/credits"');
    expect(html).toContain(">Top up<");
  });

  it("an admin also sees After Dark, read-only: the house's providers, not their own keys", async () => {
    signIn();
    await claimAdmin(t.db, U);
    await saveAdultSettings(t.db, { openrouter_key: fakeKey("house"), hive_key: fakeKey("hive") });
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status) values ('hive', now() + interval '2 hours', 429)`);
    const html = await page();
    expect(html).toContain("🌙 After Dark");
    expect(html).toContain("Studio pictures can also run on your own key");
    // After Dark is open to an admin: its own job's card too.
    expect(html).toContain("After Dark pictures");
    expect(html).toContain("Something&#x27;s paused");
    expect(html).toMatch(/Hive ⏸ until <time dateTime="[^"]+">\d\d:\d\d UTC<\/time>/);
    expect(html).toContain('href="/admin/after-dark/providers"');
    expect(html).not.toContain(fakeKey("house"));
    // Not on a device that hasn't entered the After Dark PIN.
    await t.db.query(`insert into adult_privacy (user_id, pin_hash, pin_version) values ($1, 'a-pin-hash', 1)`, [U]);
    expect(await page()).not.toMatch(/after dark/i);
  });
});

describe("caps on the page (M3)", () => {
  it("a capped job's card draws its spend as a meter, amber past 80%", async () => {
    signIn();
    await saveConnection(t.db, U, "openrouter", fakeKey("meter"));
    await assignJob(t.db, U, "text", "openrouter", null, {}, { cap_usd: 10 });
    await recordUsage(t.db, U, "text", { usd: 8.1, how: "reported", input: 0, output: 0 });
    const html = await page();
    expect(html).toContain("80% of cap");
    expect(html).toContain("$8.10 of $10 this month");
    expect(html).toMatch(/<div class="usage-meter level-warn" role="meter" aria-label="This month&#x27;s spend against the cap" aria-valuemin="0" aria-valuemax="10" aria-valuenow="8.1" aria-valuetext="\$8.10 of \$10 this month"><span style="width:81%"><\/span><\/div>/);
  });

  it("at the cap: the card says what happens until the 1st", async () => {
    signIn();
    await saveConnection(t.db, U, "openrouter", fakeKey("full"));
    await assignJob(t.db, U, "text", "openrouter", null, {}, { cap_usd: 5, on_cap: "fallback" });
    await recordUsage(t.db, U, "text", { usd: 5.2, how: "reported", input: 0, output: 0 });
    const html = await page();
    expect(html).toContain("Cap reached");
    expect(html).toMatch(/Cap reached: Botchelor&#x27;s free model stands in until [A-Z][a-z]{2} 1/);
    expect(html).toContain('style="width:100%"');
  });

  it("the flow's cap step: an amount, and for Dates & texts what happens at the cap; portraits just wait", () => {
    const text = renderToStaticMarkup(
      createElement(KeyForm, {
        job: "text",
        jobTitle: "Dates & texts",
        providers: [{ id: "openai", label: "OpenAI", blurb: "", keyHint: "Starts with sk-", keysUrl: "https://platform.openai.com/api-keys", stored: { last4: "2468" }, models: modelOptions("openai", "text", null) }],
        current: { provider: "openai", model: "gpt-4.1-mini", cap: { cap_usd: 10, on_cap: "pause" } },
        also: [],
        onDone: () => {},
      }),
    );
    expect(text).toContain("Monthly cap");
    expect(text).toMatch(/<input type="number" inputMode="decimal" min="0" max="1000" step="1" placeholder="no cap"[^>]*value="10"/);
    expect(text).toMatch(/checked=""\/> My dates wait until it&#x27;s fixed/);
    expect(text).toContain("Botchelor&#x27;s free model stands in, so dates (and a few texts a day) carry on");
    const image = renderToStaticMarkup(
      createElement(KeyForm, {
        job: "image",
        jobTitle: "Portraits & pictures",
        providers: [{ id: "openai", label: "OpenAI", blurb: "", keyHint: "Starts with sk-", keysUrl: "https://platform.openai.com/api-keys", stored: { last4: "2468" }, models: modelOptions("openai", "image", null) }],
        current: { provider: null, model: null },
        also: [],
        onDone: () => {},
      }),
    );
    expect(image).toContain("At the cap, portraits wait until the 1st");
    expect(image).not.toContain("My dates wait");
  });
});

describe("the card and the connect flow, on their own", () => {
  it("the card: the provider's mark, the state's pill and tone, and an error's fix as a link", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionCard, { id: "dates", title: "Dates & texts", provider: "openrouter", tone: "error", pill: "Needs attention", status: "Your OpenRouter key", error: plainError("openrouter", "invalid_key") }),
    );
    expect(html).toContain('class="card connection-card tone-error"');
    expect(html).toContain('data-provider="openrouter"');
    expect(html).toContain(">OR</text>");
    expect(html).toContain('href="https://openrouter.ai/settings/keys"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("a provider mark is drawn inline (no image to load), and decorative", () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { provider: "google" }));
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/<img|href=/);
  });

  it("the flow starts on the provider, with a stored key offered again without pasting", () => {
    const html = renderToStaticMarkup(
      createElement(KeyForm, {
        job: "image",
        jobTitle: "Portraits & pictures",
        providers: [{ id: "openai", label: "OpenAI", blurb: "", keyHint: "Starts with sk-", keysUrl: "https://platform.openai.com/api-keys", stored: { last4: "2468" }, models: modelOptions("openai", "image", null) }],
        current: { provider: null, model: null },
        also: [],
        onDone: () => {},
      }),
    );
    expect(html).toContain("Use your OpenAI key (•••• 2468)");
    expect(html).toContain("Paste a different key");
    // A stored key goes straight on to the model step: the model as a radio row, tagged Recommended.
    expect(html).toMatch(/<span class="model-id">gpt-image-2<\/span>.*>Recommended</);
    expect(html).toContain(">Save<");
  });

  it("with a new key, Save waits for a passing Test, and the paste field is a password field that isn't remembered", () => {
    const html = renderToStaticMarkup(
      createElement(KeyForm, {
        job: "text",
        jobTitle: "Dates & texts",
        providers: [{ id: "openrouter", label: "OpenRouter", blurb: "", keyHint: "Starts with sk-or-", keysUrl: "https://openrouter.ai/settings/keys", stored: null, models: modelOptions("openrouter", "text", null) }],
        current: { provider: null, model: null },
        also: [],
        onDone: () => {},
      }),
    );
    expect(html).toMatch(/<input type="password" autoComplete="off" spellCheck="false"/);
    expect(html).toContain(">Test<");
    expect(html).not.toContain(">Save<");
  });
});

describe("the admin's After Dark providers view", () => {
  it("a card per house provider with its live status; not found for anyone else, or on a locked device", async () => {
    const notFound = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
    await expect(AfterDarkProvidersPage()).rejects.toThrow(notFound);
    signIn();
    await expect(AfterDarkProvidersPage()).rejects.toThrow(notFound); // signed in, but not an admin
    await claimAdmin(t.db, U);
    await saveAdultSettings(t.db, { openrouter_key: fakeKey("or"), venice_key: fakeKey("ve"), hive_key: fakeKey("hv"), media_provider: "venice" });
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status) values ('hive', now() + interval '90 minutes', 429)`);
    const html = renderToStaticMarkup(await AfterDarkProvidersPage());
    for (const label of ["OpenRouter", "Venice", "Replicate", "fal.ai", "Hive"]) expect(html).toContain(`>${label}</h2>`);
    expect(html).toMatch(/Daily limit reached: back around <time dateTime="[^"]+">\d\d:\d\d UTC<\/time>/);
    expect(html).toContain("•••• 2468");
    expect(html).not.toContain(fakeKey("or"));
    await t.db.query(`insert into adult_privacy (user_id, pin_hash, pin_version) values ($1, 'a-pin-hash', 1)`, [U]);
    await expect(AfterDarkProvidersPage()).rejects.toThrow(notFound);
  });
});
