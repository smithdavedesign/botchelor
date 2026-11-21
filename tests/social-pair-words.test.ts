import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PairTiesCard from "@/app/graph/PairTiesCard";
import { pairDate, pairHistory, pairRows, sharedWords, tieSentence, tieWhen } from "@/lib/social/pair-words";
import type { PairTies, TieEventView, TieView } from "@/lib/social/types";

// The pair panel's words (lib/social/pair-words.ts): every tie between two characters, and their history, a line each.

const ADA = { id: "pw-ada", name: "Ada Lovelace", private: false, portrait: null, hue: 10 };
const BEA = { id: "pw-bea", name: "Bea Arthur", private: false, portrait: null, hue: 200 };

function tie(over: Partial<TieView> & Pick<TieView, "id" | "kind" | "layer">): TieView {
  return {
    from: ADA.id,
    to: BEA.id,
    to_person: null,
    directed: false,
    valence: 1,
    closeness: 0.5,
    status: "active",
    visibility: "public",
    source: "derived",
    source_ref: null,
    evidence: [],
    detail: {},
    story: null,
    since_text: null,
    started_at: "2026-11-03T12:00:00.000Z",
    ended_at: null,
    last_contact_at: null,
    ...over,
  };
}
const event = (over: Partial<TieEventView> & Pick<TieEventView, "tie_id" | "kind" | "event" | "at">): TieEventView => ({ changes: {}, source: "derived", source_ref: null, ...over });
const pair = (ties: TieView[], events: TieEventView[] = []): PairTies => ({ a: ADA, b: BEA, ties, events, shared: [], places: [], personal: false });

describe("the pair panel's words", () => {
  it("says a tie as the pair's words, a directed one as a sentence with who did it", () => {
    const name = (id: string) => (id === ADA.id ? "Ada" : "Bea");
    expect(tieSentence(tie({ id: "t1", kind: "best_friend", layer: "friendship" }), name)).toBe("best friends");
    expect(tieSentence(tie({ id: "t2", kind: "told", layer: "communication", directed: true }), name)).toBe("Ada told Bea");
    // "to is from's <kind>": Bea is Ada's mentor.
    expect(tieSentence(tie({ id: "t3", kind: "mentor", layer: "work", directed: true }), name)).toBe("Bea is Ada's mentor");
  });

  it("says when: since a date or the owner's words, and a span once it's over", () => {
    expect(tieWhen({ status: "active", since_text: null, started_at: "2026-11-03T12:00:00Z", ended_at: null })).toBe(`since ${pairDate("2026-11-03T12:00:00Z")}`);
    expect(tieWhen({ status: "active", since_text: "school", started_at: "2026-11-03T12:00:00Z", ended_at: null })).toBe("since school");
    expect(tieWhen({ status: "ended", since_text: null, started_at: "2026-11-03T12:00:00Z", ended_at: "2026-11-18T12:00:00Z" })).toBe("3 Nov 2026 – 18 Nov 2026");
    expect(tieWhen({ status: "ended", since_text: null, started_at: null, ended_at: null })).toBe("over");
    expect(tieWhen({ status: "active", since_text: null, started_at: null, ended_at: null })).toBe("");
  });

  it("rows: the ties still on first, each drawn as the sky draws it, red while it feels bad", () => {
    const rows = pairRows(
      pair([
        tie({ id: "t1", kind: "feud", layer: "conflict", valence: -1, status: "ended", ended_at: "2026-11-10T00:00:00Z" }),
        tie({ id: "t2", kind: "rival", layer: "conflict", valence: -1 }),
        tie({ id: "t3", kind: "coworker", layer: "work" }),
        tie({ id: "t4", kind: "friend", layer: "friendship", status: "proposed" }),
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(["t2", "t3", "t1"]);
    expect(rows[0]).toMatchObject({ words: "rivals", style: "rival", sour: true, over: false });
    expect(rows[1]).toMatchObject({ words: "coworkers", style: "work", sour: false });
    // A feud that's over isn't red any more.
    expect(rows[2]).toMatchObject({ words: "feuding", over: true, sour: false });
    // A sentence about the two uses their first names: the panel's heading has the full ones.
    expect(pairRows(pair([tie({ id: "t5", kind: "told", layer: "communication", directed: true })]))[0].words).toBe("Ada told Bea");
  });

  it("history: newest first, what happened to which tie, and nothing a page doesn't tell", () => {
    const ties = [tie({ id: "t1", kind: "rival", layer: "conflict", valence: -1 }), tie({ id: "t2", kind: "friend", layer: "friendship" })];
    const moments = pairHistory(
      pair(ties, [
        event({ tie_id: "t2", kind: "friend", event: "created", at: "2026-11-01T00:00:00Z" }),
        event({ tie_id: "t1", kind: "rival", event: "created", at: "2026-11-05T00:00:00Z", source_ref: "scene:sc-1" }),
        event({ tie_id: "t2", kind: "friend", event: "changed", at: "2026-11-06T00:00:00Z", changes: { closeness: [0.5, 0.3] } }),
        event({ tie_id: "t2", kind: "friend", event: "changed", at: "2026-11-07T00:00:00Z", changes: { story: ["", "x"] } }),
        event({ tie_id: "t2", kind: "friend", event: "proposed", at: "2026-11-08T00:00:00Z" }),
        event({ tie_id: "gone", kind: "feud", event: "ended", at: "2026-11-09T00:00:00Z" }),
      ]),
    );
    expect(moments.map((m) => [m.words, m.tag])).toEqual([
      ["feuding", "ended"],
      ["friends", "cooler"],
      ["rivals", "started"],
      ["friends", "started"],
    ]);
    expect(moments[2]).toMatchObject({ kind: "rival", ref: "scene:sc-1", style: "rival" });
  });

  it("names the places they share once each", () => {
    const shared = [
      { a: ADA.id, b: BEA.id, place_id: "p1", role: "regular" as const, layer: "place" as const, words: "Regulars at the dive bar" },
      { a: ADA.id, b: BEA.id, place_id: "p1", role: "regular" as const, layer: "place" as const, words: "Regulars at the dive bar" },
      { a: ADA.id, b: BEA.id, place_id: "p2", role: "from" as const, layer: "place" as const, words: "Both from Leeds" },
    ];
    expect(sharedWords(shared)).toEqual(["Regulars at the dive bar", "Both from Leeds"]);
  });

  it("draws as a card: the ties with what made them, the places they share, the history under a fold", () => {
    const p = pair(
      [
        tie({ id: "t1", kind: "rival", layer: "conflict", valence: -1, evidence: [{ ref: "scene:sc-9#2", at: "2026-11-05T00:00:00Z" }] }),
        tie({ id: "t2", kind: "dated", layer: "romance", evidence: [{ ref: "episode:ep-1", at: "2026-11-01T00:00:00Z" }] }),
      ],
      [event({ tie_id: "t1", kind: "rival", event: "created", at: "2026-11-05T00:00:00Z", source_ref: "scene:sc-9#2" })],
    );
    p.shared = [{ a: ADA.id, b: BEA.id, place_id: "p1", role: "regular", layer: "place", words: "Regulars at the dive bar" }];
    const html = renderToStaticMarkup(createElement(PairTiesCard, { pair: p, closedSeasons: new Set<string>() })).replace(/<!-- -->/g, "");
    expect(html).toContain("Everything between them</h3>");
    expect(html).toContain("rivals");
    expect(html).toContain('href="/house?scene=sc-9#scene-sc-9"');
    expect(html).toContain("dated on the show");
    expect(html).toContain("Regulars at the dive bar");
    expect(html).toMatch(/<details class="pair-ties-history"><summary class="small">Their history <span class="muted">\(1\)<\/span><\/summary>/);
    // Where the dates are told already (Love's panel, the couple page): the dating isn't said again.
    const skipped = renderToStaticMarkup(createElement(PairTiesCard, { pair: p, closedSeasons: new Set<string>(), skipDated: true, level: 2 }));
    expect(skipped).toContain("Everything between them</h2>");
    expect(skipped).not.toContain("dated on the show");
    // Nothing but their dates: no card at all.
    expect(renderToStaticMarkup(createElement(PairTiesCard, { pair: pair([tie({ id: "t2", kind: "dated", layer: "romance" })]), closedSeasons: new Set<string>(), skipDated: true }))).toBe("");
  });
});
