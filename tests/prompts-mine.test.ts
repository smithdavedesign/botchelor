// Your prompts on /prompts (app/prompts/MyPromptsContext.tsx): the page reads the session on the server, so a signed-out
// visitor is asked to sign in without the browser asking /api/library (it answers accounts only), and a card's Save
// compares words the way the library keeps them, so one already kept reads "Saved ✓" after a reload.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    const at = jar.cookie.indexOf("=");
    const [name, value] = [jar.cookie.slice(0, at), jar.cookie.slice(at + 1)];
    return { get: (n: string) => (jar.cookie && n === name ? { value } : undefined), has: () => false, getAll: () => [] };
  },
  headers: async () => new Headers(),
}));

import { prerender } from "react-dom/static";
import { promptKey } from "@/app/prompts/MyPromptsContext";
import { PROMPTS_PER_PAGE } from "@/lib/prompts-library";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  jar.cookie = "";
  vi.unstubAllEnvs();
});

async function render(): Promise<string> {
  const { default: PromptsPage } = await import("@/app/prompts/page");
  const { prelude } = await prerender(await PromptsPage({ searchParams: Promise.resolve({}) }));
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

describe("/prompts and the viewer's own prompts", () => {
  it("signed out: one line asks them to sign in, and every card still has its Save", async () => {
    const html = await render();
    expect(html).toContain('class="muted small my-prompts-signin"');
    expect(html).toContain('class="page-wide prompts-page"');
    expect(html.match(/class="button-ghost small prompt-save"/g)).toHaveLength(PROMPTS_PER_PAGE);
  });

  it("signed in: no sign-in line (their list is read in the browser)", async () => {
    jar.cookie = signedInCookie(crypto.randomUUID());
    const html = await render();
    expect(html).not.toContain("my-prompts-signin");
    expect(html.match(/class="button-ghost small prompt-save"/g)).toHaveLength(PROMPTS_PER_PAGE);
  });

  it("compares a prompt's words as the library keeps them: one line, any case", () => {
    expect(promptKey("  Golden   HOUR\non a rooftop ")).toBe(promptKey("golden hour on a rooftop"));
    expect(promptKey("golden hour")).not.toBe(promptKey("golden hours"));
  });
});
