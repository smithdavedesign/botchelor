import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BotReviews from "@/app/BotReviews";
import { BOT_REVIEWS, BOT_REVIEWS_PAGE, botReviewFilter, botReviewsPage, type BotReview } from "@/lib/bot-reviews";
import { checkShowText } from "@/lib/safety";

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

  it("pages and filters, landing out-of-range pages on the nearest one", () => {
    const list = [...Array.from({ length: 8 }, (_, i) => review(i)), review(8, { said: "gripe", issue: 1 }), review(9, { said: "gripe", issue: 1, fixed: 2 })];
    expect(BOT_REVIEWS_PAGE).toBe(6);
    expect(botReviewsPage("all", undefined, list)).toMatchObject({ page: 1, pages: 2, total: 10 });
    expect(botReviewsPage("all", "2", list).items.map((r) => r.id)).toEqual(["r6", "r7", "r8", "r9"]);
    expect(botReviewsPage("all", "99", list).page).toBe(2);
    expect(botReviewsPage("all", "nope", list).page).toBe(1);
    expect(botReviewsPage("gripe", "1", list)).toMatchObject({ pages: 1, total: 2, tracked: 1, fixed: 1 });
    expect(botReviewFilter("loved")).toBe("loved");
    expect(botReviewFilter("<script>")).toBe("all");
  });

  it("a visitor quoted twice counts as one rating in the average", () => {
    const list = [review(1, { visitor: "a", rating: 6 }), review(2, { visitor: "a", rating: 6 }), review(3, { visitor: "b", rating: 9 })];
    expect(botReviewsPage("all", "1", list)).toMatchObject({ visitors: 2, average: 7.5 });
  });

  it("renders the filter, the pager and each gripe's status, with no GitHub link for the public (the repo is private)", () => {
    const html = renderToStaticMarkup(createElement(BotReviews, { said: "gripe", page: "1", keep: { ref: "rp-discord" } }));
    expect(html).toContain("What the bots are saying");
    expect(html).toContain('aria-current="true"');
    // Each gripe on the page says where it stands: open ones "We're on it", fixed ones "Fixed" (which depends on the data).
    const shown = botReviewsPage("gripe", "1").items;
    if (shown.some((r) => r.issue && !r.fixed)) expect(html).toMatch(/We&#x27;re on it: issue #\d+/);
    if (shown.some((r) => r.issue && r.fixed)) expect(html).toMatch(/✅ Fixed \(#\d+, in #\d+\)/);
    expect(html).not.toContain("github.com");
    // Filter links keep the ref the visitor came with, on /reviews (2026-10-31 UX audit).
    expect(html).toContain('href="/reviews?ref=rp-discord"');
    const all = renderToStaticMarkup(createElement(BotReviews, { said: undefined, page: undefined, keep: {} }));
    if (BOT_REVIEWS.length > BOT_REVIEWS_PAGE) expect(all).toContain('href="/reviews?bots=2"');
  });

  it("on the home page, quotes the newest three and links to the rest, with no filter, pager or to-do notes", () => {
    const html = renderToStaticMarkup(createElement(BotReviews, { said: "gripe", page: "2", keep: { ref: "rp-discord" }, compact: true }));
    expect(html.match(/<li class="card bot-card/g)).toHaveLength(Math.min(3, BOT_REVIEWS.length));
    expect(html).toContain(`Read all ${BOT_REVIEWS.length} reviews`);
    expect(html).toContain('href="/reviews?ref=rp-discord"');
    expect(html).not.toContain("bot-filter");
    expect(html).not.toContain("bot-status");
  });
});
