import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BotReviews from "@/app/BotReviews";
import { BOT_REVIEWS, BOT_REVIEWS_PAGE, botReviewFilter, botReviewsPage, gripeStatus, gripeTally, innerQuotes, tallyLine, type BotReview } from "@/lib/bot-reviews";
import { checkShowText } from "@/lib/safety";
import { readFileSync } from "node:fs";

/** A chip's drawn icon (app/Icon.tsx), then its words: the markers are icons, not emoji (visual audit 2026-11-20). */
const ICON = /<svg class="icon"[^>]*>.*?<\/svg>/;
const CHIP = (words: string) => new RegExp(`<span class="chip">${ICON.source} ${words}</span>`);

const review = (n: number, o: Partial<BotReview> = {}): BotReview => ({
  id: `r${n}`, visitor: `run/${n}`, said: "loved", quote: `Line ${n}.`, rating: 8, model: "Claude Sonnet 5.5", date: "2026-10-20", ...o,
});

describe("what the bots are saying (David, 2026-10-20)", () => {
  it("every review is well-formed: a quote that passes the show's content rules, a model, a rating, and a gripe says where it went", () => {
    expect(new Set(BOT_REVIEWS.map((r) => r.id)).size).toBe(BOT_REVIEWS.length);
    for (const r of BOT_REVIEWS) {
      expect(checkShowText({ quote: r.quote }).ok, r.id).toBe(true);
      expect(r.model.trim(), r.id).not.toBe("");
      expect(r.rating >= 1 && r.rating <= 10, r.id).toBe(true);
      expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.said === "gripe") expect(Boolean(r.issue) || Boolean(r.note), r.id).toBe(true);
      else expect(r.issue, r.id).toBeUndefined();
    }
    // The fun is in both: the section shows the gripes too.
    expect(BOT_REVIEWS.some((r) => r.said === "loved") && BOT_REVIEWS.some((r) => r.said === "gripe")).toBe(true);
  });

  it("prints a quoted line inside a quote in single marks, so a quote never ends in two closing marks (2026-11-13)", () => {
    expect(innerQuotes('Nell said "A gap in a log is a lie."')).toBe("Nell said ‘A gap in a log is a lie.’");
    expect(innerQuotes('No quotes here.')).toBe("No quotes here.");
    const html = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {} }));
    expect(html).not.toContain("&quot;”");
    expect(html).not.toContain('"”');
  });

  it("keeps up with the visitor loop: the newest review is from this month", () => {
    const newest = BOT_REVIEWS.map((r) => r.date).sort().at(-1) ?? "";
    expect(newest >= "2026-11-13").toBe(true);
  });

  it("pages and filters, landing out-of-range pages on the nearest one", () => {
    const list = [...Array.from({ length: 8 }, (_, i) => review(i)), review(8, { said: "gripe", issue: 1 }), review(9, { said: "gripe", issue: 1, fixed: 2 })];
    expect(BOT_REVIEWS_PAGE).toBe(6);
    expect(botReviewsPage("all", undefined, list)).toMatchObject({ page: 1, pages: 2, total: 10 });
    expect(botReviewsPage("all", "2", list).items.map((r) => r.id)).toEqual(["r6", "r7", "r8", "r9"]);
    expect(botReviewsPage("all", "99", list).page).toBe(2);
    expect(botReviewsPage("all", "nope", list).page).toBe(1);
    expect(botReviewsPage("gripe", "1", list)).toMatchObject({ pages: 1, total: 2, tally: { gripes: 2, fixed: 1, open: 1, answered: 0 } });
    expect(botReviewFilter("loved")).toBe("loved");
    expect(botReviewFilter("<script>")).toBe("all");
  });

  it("a visitor quoted twice counts as one rating in the average", () => {
    const list = [review(1, { visitor: "a", rating: 6 }), review(2, { visitor: "a", rating: 6 }), review(3, { visitor: "b", rating: 9 })];
    expect(botReviewsPage("all", "1", list)).toMatchObject({ visitors: 2, average: 7.5 });
  });

  it("renders the filter, the pager and each gripe's status, the fix linked on GitHub (the repo is public)", () => {
    const html = renderToStaticMarkup(createElement(BotReviews, { said: "gripe", page: "1", keep: { ref: "rp-discord" } }));
    expect(html).toContain("What the bots are saying");
    expect(html).toContain('aria-current="true"');
    // Each gripe on the page says where it stands, in its chip and under the quote (which depends on the data).
    const shown = botReviewsPage("gripe", "1").items;
    if (shown.some((r) => gripeStatus(r) === "open")) expect(html).toMatch(/<strong>Open<\/strong>: we&#x27;re on it, issue <a class="issue-link" href="https:\/\/github\.com\/smithdavedesign\/botchelor\/issues\/\d+"/);
    if (shown.some((r) => gripeStatus(r) === "fixed")) expect(html).toMatch(/<strong>Fixed \w{3} \d+<\/strong> in <a class="issue-link" href="https:\/\/github\.com\/smithdavedesign\/botchelor\/pull\/\d+"/);
    // The gripes page by where they stand, so the pager says Previous and Next, not Newer and Older.
    expect(html).not.toContain("Older");
    // Filter links keep the ref the visitor came with, on /reviews (2026-10-31 UX audit).
    expect(html).toContain('href="/reviews?ref=rp-discord"');
    const all = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {} }));
    if (BOT_REVIEWS.length > BOT_REVIEWS_PAGE) expect(all).toContain('href="/reviews?bots=2"');
    // Everything and the praise are newest first.
    expect(all).toContain("Older");
  });

  it("on the home page, quotes the newest three and links to the rest, with no filter, pager or to-do notes", () => {
    const html = renderToStaticMarkup(createElement(BotReviews, { said: "gripe", page: "2", keep: { ref: "rp-discord" }, compact: true }));
    expect(html.match(/<li class="card bot-card/g)).toHaveLength(Math.min(3, BOT_REVIEWS.length));
    expect(html).toContain(`Read all ${BOT_REVIEWS.length} reviews`);
    expect(html).toContain('href="/reviews?ref=rp-discord"');
    expect(html).not.toContain("filter-pills");
    expect(html).not.toContain("pager");
    // The strip says how the gripes stand too, in the same words as /reviews.
    expect(html).toContain(`${tallyLine(gripeTally()).replace("'", "&#x27;")}.`);
  });
});

// 2026-11-15: an outside review of the site quoted the look-alike gripe (#1518) as a live problem. It had been fixed and
// closed two days before; the card still said "We're on it". A fixed gripe has to read as fixed, wherever it's quoted.
describe("the filter and chips are drawn icons (docs/brand.md, Icons)", () => {
  it("marks praise and gripes with icons, never emoji, on /reviews and the /agents strip", () => {
    expect(readFileSync("app/BotReviews.tsx", "utf8")).not.toMatch(/💗|🛠|✅/u);
    const html = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {} }));
    expect(html).not.toMatch(/💗|🛠|✅/u);
    const filter = html.slice(html.indexOf('<nav class="filter-pills"'), html.indexOf("</nav>"));
    expect(filter).toMatch(new RegExp(`${ICON.source}Loved it</a>`));
    expect(filter).toMatch(new RegExp(`${ICON.source}Gripes</a>`));
    const loved = renderToStaticMarkup(createElement(BotReviews, { said: "loved", page: "1", keep: {} }));
    expect(loved).toMatch(CHIP("Loved it"));
  });

  it("balances a page of quotes: six are three and three, the /agents strip's three one row", () => {
    const list = Array.from({ length: BOT_REVIEWS_PAGE }, (_, i) => review(i + 1));
    expect(BOT_REVIEWS_PAGE).toBe(6);
    const html = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {}, reviews: list }));
    expect(html).toContain('<ul class="bot-grid grid-balanced" style="--cols:3">');
    const strip = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {}, compact: true, reviews: list }));
    expect(strip).toContain('<ul class="bot-grid grid-balanced" style="--cols:3">');
  });
});

describe("a fixed gripe reads as fixed", () => {
  /** agent-feedback issues quoted here that GitHub shows closed as completed (read 2026-11-15). Add one when it closes. */
  const CLOSED = [446, 467, 469, 472, 489, 502, 505, 514, 1518];

  it("every gripe whose issue is closed names the PR that fixed it and the day, and nothing is fixed without a PR", () => {
    for (const r of BOT_REVIEWS) {
      if (r.issue && CLOSED.includes(r.issue)) expect(r.fixed, r.id).toBeGreaterThan(0);
      if (r.fixed) expect(r.fixedOn, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A fix comes after the complaint, and only a gripe can be fixed.
      if (r.fixed) expect([r.said, (r.fixedOn ?? "") >= r.date], r.id).toEqual(["gripe", true]);
      if (r.fixedOn) expect(r.fixed, r.id).toBeGreaterThan(0);
    }
    expect(BOT_REVIEWS.find((r) => r.issue === 1518)).toMatchObject({ fixed: 1538, fixedOn: "2026-11-13" });
  });

  it("a gripe is fixed, open or not a bug; praise has no status", () => {
    expect(gripeStatus(review(1))).toBeNull();
    expect(gripeStatus(review(2, { said: "gripe", issue: 7 }))).toBe("open");
    expect(gripeStatus(review(3, { said: "gripe", issue: 7, fixed: 9 }))).toBe("fixed");
    expect(gripeStatus(review(4, { said: "gripe", note: "Not a bug." }))).toBe("answered");
    // Our test crowd's gripes had no issue, and were fixed all the same.
    expect(gripeStatus(review(5, { said: "gripe", note: "Our crowd.", fixed: 9 }))).toBe("fixed");
  });

  it("tallies the gripes a quote each, in one line", () => {
    const list = [review(1), review(2, { said: "gripe", issue: 7 }), review(3, { said: "gripe", issue: 7, fixed: 9 }), review(4, { said: "gripe", issue: 8, fixed: 9 }), review(5, { said: "gripe", note: "Not a bug." })];
    expect(gripeTally(list)).toEqual({ gripes: 4, fixed: 2, open: 1, answered: 1 });
    expect(tallyLine(gripeTally(list))).toBe("2 of 4 gripes fixed, 1 open; 1 wasn't a bug");
    expect(tallyLine({ gripes: 3, fixed: 3, open: 0, answered: 0 })).toBe("3 of 3 gripes fixed, none open");
    expect(tallyLine({ gripes: 1, fixed: 0, open: 1, answered: 0 })).toBe("0 of 1 gripe fixed, 1 open");
    expect(tallyLine({ gripes: 5, fixed: 3, open: 0, answered: 2 })).toBe("3 of 5 gripes fixed, none open; 2 weren't bugs");
    expect(tallyLine(gripeTally([review(1)]))).toBe("");
    // The live list: the tally is on the page, over the filter.
    const html = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {} }));
    expect(html).toContain(`<p class="bot-tally">${tallyLine(gripeTally()).replace("'", "&#x27;")}.</p>`);
  });

  it("the gripes filter leads with what's open, then what wasn't a bug, then what's fixed", () => {
    const list = [review(1, { said: "gripe", issue: 1, fixed: 2 }), review(2, { said: "gripe", note: "Not a bug." }), review(3, { said: "gripe", issue: 3 }), review(4, { said: "gripe", issue: 4, fixed: 5 }), review(5, { said: "gripe", issue: 6 })];
    expect(botReviewsPage("gripe", "1", list).items.map((r) => r.id)).toEqual(["r3", "r5", "r2", "r1", "r4"]);
    // Everything stays as listed: newest first.
    expect(botReviewsPage("all", "1", list).items.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("marks the card: a Fixed chip, the day and the fix linked; an open one says Open; neither reads as the other", () => {
    const card = (html: string, id: string) => {
      // Up to the quote's first quotation mark or apostrophe: the page prints those differently.
      const quote = BOT_REVIEWS.find((r) => r.id === id)!.quote.split(/["']/)[0].slice(0, 20);
      const at = html.indexOf(quote);
      return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
    };
    // Every gripe, a page at a time.
    const pages = botReviewsPage("gripe", "1").pages;
    const html = Array.from({ length: pages }, (_, i) => renderToStaticMarkup(createElement(BotReviews, { said: "gripe", page: String(i + 1), keep: {} }))).join("");
    const lookalikes = card(html, "1113-1227-1-lookalikes");
    expect(lookalikes).toContain('class="card bot-card bot-gripe bot-fixed"');
    expect(lookalikes).toMatch(CHIP("Fixed gripe"));
    expect(lookalikes).toContain('<strong>Fixed Nov 13</strong> in <a class="issue-link" href="https://github.com/smithdavedesign/botchelor/pull/1538" target="_blank" rel="noreferrer">#1538</a>');
    expect(lookalikes).toContain('issues/1518"');
    expect(lookalikes).not.toMatch(/on it|Open/);
    for (const r of BOT_REVIEWS.filter((x) => x.said === "gripe")) {
      const c = card(html, r.id);
      const status = gripeStatus(r);
      expect(c, r.id).toContain(`bot-${status}"`);
      expect(CHIP("Fixed gripe").test(c), r.id).toBe(status === "fixed");
      expect(c.includes("<strong>Open</strong>"), r.id).toBe(status === "open");
      if (status === "answered") expect(c, r.id).toContain("Gripe · not a bug");
    }
    // Praise wears no status.
    const loved = renderToStaticMarkup(createElement(BotReviews, { said: "loved", page: "1", keep: {} }));
    expect(loved).not.toMatch(/bot-fixed|bot-open|bot-status/);
  });

  it("the /agents strip wears the same mark on a gripe among its three", () => {
    const list = [review(1, { said: "gripe", issue: 7, fixed: 9, fixedOn: "2026-11-02", quote: "It broke." }), review(2, { said: "gripe", issue: 8, quote: "Still broken." }), review(3), review(4)];
    const html = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {}, compact: true, reviews: list }));
    expect(html.match(/<li class="card bot-card/g)).toHaveLength(3);
    expect(html).toMatch(new RegExp(`<li class="card bot-card bot-gripe bot-fixed"><span class="chip">${ICON.source} Fixed gripe</span>`));
    expect(html).toContain('<strong>Fixed Nov 2</strong> in <a class="issue-link" href="https://github.com/smithdavedesign/botchelor/pull/9"');
    expect(html).toMatch(new RegExp(`<li class="card bot-card bot-gripe bot-open"><span class="chip">${ICON.source} Gripe · open</span>`));
    expect(html).toContain("1 of 2 gripes fixed, 1 open.");
    expect(html).toContain("Read all 4 reviews");
    // They are AI agents' reviews, and the strip says so.
    expect(html).toContain("What the bots are saying");
    expect(html).toContain("AI agents nobody briefed");
  });
});
