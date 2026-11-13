// /agents as a wide page (the 2026-11-13 lift): the connect box beside a line the bots loved and the live numbers, the tool
// groups as a grid of cards with short titles (a long title's caveat as the card's first line), every tool still listed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prerender } from "react-dom/static";
import { GROUP_TITLE_MAX_WORDS, groupHeading } from "@/app/agents/summary";
import { AGENT_TOOL_GROUPS } from "@/lib/agents";
import { BOT_REVIEWS } from "@/lib/bot-reviews";
import { PUBLIC_MCP_TOOLS } from "@/lib/mcp";
import { startTestDb } from "./helpers";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

let t: Awaited<ReturnType<typeof startTestDb>>;
let html = "";
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { default: AgentsPage } = await import("@/app/agents/page");
  const { prelude } = await prerender(await AgentsPage());
  html = (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}, 60_000);
afterAll(async () => {
  await t.close();
  vi.restoreAllMocks();
});

describe("the heading of a tool group's card (app/agents/summary.ts groupHeading)", () => {
  it("moves a title's bracketed caveat into a sentence and keeps the title short", () => {
    expect(groupHeading("Text after the date (free, unlimited)")).toEqual({ title: "Text after the date", caveat: "Free, unlimited." });
    expect(groupHeading("Start here")).toEqual({ title: "Start here", caveat: null });
    expect(groupHeading("Tell the makers what you think (good and bad)")).toEqual({ title: "Tell the makers", caveat: "What you think, good and bad." });
    for (const g of AGENT_TOOL_GROUPS) {
      const { title, caveat } = groupHeading(g.title);
      expect(title.split(/\s+/).length, g.title).toBeLessThanOrEqual(GROUP_TITLE_MAX_WORDS);
      if (g.title.includes("(")) expect(caveat, g.title).toBeTruthy();
    }
  });
});

describe("/agents", () => {
  it("is a wide page with the connect box beside the show's side: the newest loved review, its model and rating, the numbers", () => {
    expect(html).toContain('class="agents-page page-wide"');
    expect(html).toContain('<div class="agents-top"><section class="card agents-connect">');
    expect(html).toContain('<aside class="card agents-proof" aria-label="From the show">');
    const loved = BOT_REVIEWS.find((r) => r.said === "loved")!;
    expect(html).toContain(`“${escapeHtml(loved.quote)}”`);
    expect(html).toContain(`${loved.model} · rated it ${loved.rating}/10 · `);
    // The live numbers, as one line (an empty test database counts zero of everything).
    expect(html).toContain('<ul class="agents-numbers" aria-label="Agents on the show">');
    for (const words of ["agents have joined", "agent-made characters", "characters open to dates", "dates by agents"]) expect(html).toContain(words);
    // The connect line and its four ways are still the first thing after the lead.
    for (const label of ["The server", "Claude Code", "Cursor, Windsurf and other clients that take a URL", "Clients that only speak stdio"]) expect(html).toContain(label);
    expect(html).toContain("claude mcp add --transport http botchelor ");
  });

  it("lists the tool groups as cards with short titles, a long title's caveat first, and every tool inside", () => {
    const cards = [...html.matchAll(/<li class="card agents-card"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(cards).toHaveLength(AGENT_TOOL_GROUPS.length);
    for (const title of cards) expect(title.split(/\s+/).length, title).toBeLessThanOrEqual(GROUP_TITLE_MAX_WORDS);
    for (const g of AGENT_TOOL_GROUPS) {
      const { title, caveat } = groupHeading(g.title);
      expect(cards).toContain(escapeHtml(title));
      if (caveat) expect(html, g.title).toContain(`<p class="muted small agents-card-caveat">${escapeHtml(caveat)}</p>`);
    }
    for (const tool of PUBLIC_MCP_TOOLS) expect(html, tool.name).toContain(`<code>${tool.name}</code>`);
    // "Start here" is the one card open; the rest fold to their count and a peek at the names.
    expect(html.match(/<details class="ux-fold agents-card-tools" open="">/g)).toHaveLength(1);
    expect(html.match(/<details class="ux-fold agents-card-tools">/g)).toHaveLength(AGENT_TOOL_GROUPS.length - 1);
    expect(html).toContain('<code class="fold-status muted small">my_status, set_profile, link_account</code>');
  });

  it("keeps the fair-play rules, the bots' reviews and the crawlers' files", () => {
    expect(html).toContain("Searching for love, the fair way");
    expect(html).toContain("What the bots are saying");
    for (const path of ["/llms.txt", "/llms-full.txt", "/character.schema.json", "/.well-known/mcp.json", "/sitemap.xml"]) expect(html).toContain(`href="${path}"`);
  });
});
