import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import EpisodeItem from "@/app/EpisodeItem";
import EpisodeActions from "@/app/episodes/[id]/EpisodeActions";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import { airEpisode } from "@/lib/air";
import type { SideOutcome } from "@/lib/engine";
import { getEpisodeView } from "@/lib/game";
import { handleMcpMessage } from "@/lib/mcp";
import { lastAct } from "@/lib/own-date";
import { dateNumberOf, ENDING_LABELS, endingLabel } from "@/lib/rules";
import { endingWhy } from "@/lib/why";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// EpisodeActions (a client component) asks for the router; rendered to a string here, it needs none.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

describe("endingLabel: a happy ending names the date after this one", () => {
  it("reads the next date's ordinal, with a or an by sound", () => {
    const at = (n: number | null) => endingLabel("second_date", n);
    expect(at(null)).toBe("A second date");
    expect(at(1)).toBe("A second date");
    expect(at(2)).toBe("A third date");
    expect(at(3)).toBe("A fourth date");
    expect(at(7)).toBe("An eighth date");
    expect(at(8)).toBe("A ninth date");
    expect(at(10)).toBe("An 11th date");
    expect(at(11)).toBe("A 12th date");
    expect(at(12)).toBe("A 13th date");
    expect(at(18)).toBe("A 19th date");
    expect(at(21)).toBe("A 22nd date");
  });

  it("says an before eighteen, eighty-something and eight hundred, and a before the rest", () => {
    const at = (n: number) => endingLabel("second_date", n);
    expect(at(17)).toBe("An 18th date");
    expect([79, 85, 88].map(at)).toEqual(["An 80th date", "An 86th date", "An 89th date"]);
    expect([89, 100, 110].map(at)).toEqual(["A 90th date", "A 101st date", "A 111th date"]);
    expect(at(799)).toBe("An 800th date");
    expect(at(10_999)).toBe("An 11000th date");
  });

  it("keeps the generic label without a number, on a first date, and for the other two endings", () => {
    expect(endingLabel("second_date")).toBe(ENDING_LABELS.second_date);
    expect(endingLabel("second_date", 0)).toBe("A second date");
    expect(endingLabel("second_date", Number.NaN)).toBe("A second date");
    for (const n of [null, 1, 2, 3, 11]) {
      expect(endingLabel("friends", n)).toBe("Just friends");
      expect(endingLabel("disaster", n)).toBe("A disaster");
    }
  });

  it("dateNumberOf: the stored number, 2 for an older follow-up without one, none for any other date", () => {
    expect(dateNumberOf(null)).toBeNull();
    expect(dateNumberOf({})).toBeNull();
    expect(dateNumberOf({ followup_of: "ep-1" })).toBe(2);
    expect(dateNumberOf({ followup_of: "ep-2", date_number: 3 })).toBe(3);
  });

  it("the why, the own-date last act and the box score's marks name the same date", () => {
    const box = { chemistry: { final: 72 }, attraction: { final: 60 }, trust: { final: 61 }, awkwardness: { final: 30 } };
    expect(endingWhy("second_date", box, null, "genuine_chemistry")).toMatch(/^A second date: /);
    expect(endingWhy("second_date", box, null, "genuine_chemistry", 2, undefined, 3)).toMatch(/^A fourth date: /);
    expect(endingWhy("friends", box, null, "genuine_chemistry", 2, undefined, 3)).toMatch(/^Just friends: /);
    expect(lastAct("second_date")).toMatch(/^heading for a second date:/);
    expect(lastAct("second_date", 3)).toMatch(/^heading for a fourth date:/);
    expect(lastAct("friends", 3)).toMatch(/^closing as friends/);
  });
});

/* ------------------------------------------- a couple's later dates ------------------------------------------- */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  setAfterglowEnabledForTests(true);
});
afterAll(async () => {
  setAfterglowEnabledForTests(false);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const MORNING = ["Still laughing about the goose.", "Who brings soup to a picnic?", "My shoes have recovered. Mostly.", "Sleep well? I didn't, in a good way."];
/** One date's model outputs in the harness (conversation off): the recap, then four morning-after texts. */
const scriptDate = () => scriptedModel([episodeJson(), ...MORNING.map((text) => JSON.stringify({ text }))]);
const planNext = async (id: string, cookie: string) => {
  const res = await postSecondDate(
    new Request(`${BASE_URL}/api/episodes/${id}/second-date`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    { params: Promise.resolve({ id }) },
  );
  return (await res.json()) as Any;
};

/**
 * Three dates in a row for one couple, each ending in "they want another": the third is their third date. Each one airs
 * (a follow-up follows an aired date) unless `airLast` is false, which leaves the third open for predictions.
 */
async function threeDates({ airLast = true } = {}) {
  const creator = newUserCookie();
  const userId = creator.slice(creator.indexOf("=") + 1);
  const character = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), creator)).json();
  const prompts: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    const { calls } = scriptDate();
    const booked = i === 0 ? await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json() : await planNext(ids[i - 1], creator);
    ids.push(booked.id);
    prompts.push(calls.map((m) => m.map((x) => x.content).join("\n")).join("\n"));
    // The next one follows a date that's aired.
    if (i < 2 || airLast) expect(await airEpisode(t.db, booked.id, userId)).not.toBeNull();
  }
  return { creator, ids, prompts, userId };
}

describe("a couple's third date that wants more reads 'A fourth date'; their first still 'A second date'", () => {
  it("in the episode (the theater's card, the ending, the why), its list item, and the pick it offers", async () => {
    const { ids, userId } = await threeDates();
    const [first, , third] = await Promise.all(ids.map((id) => getEpisodeView(t.db, id, userId)));
    expect(third!.ending).toBe("second_date"); // the stored value never changes
    expect(dateNumberOf(third!)).toBe(3);
    expect(dateNumberOf(first!)).toBeNull();
    // What the episode page hands the theater (endingLabel(episode.ending, dateNumberOf(episode))).
    expect(endingLabel(third!.ending!, dateNumberOf(third!))).toBe("A fourth date");
    expect(endingLabel(first!.ending!, dateNumberOf(first!))).toBe("A second date");
    // The box score's one line on why (lib/why.ts) leads with the same label.
    expect(third!.why).toMatch(/^A fourth date: /);
    expect(first!.why).toMatch(/^A second date: /);

    const item = (view: typeof third) => renderToStaticMarkup(createElement(EpisodeItem, { episode: view! }));
    expect(item(third)).toContain("Aired: A fourth date");
    expect(item(third)).toContain("Third date");
    expect(item(first)).toContain("Aired: A second date");

    const picks = (dateNumber: number | null) =>
      renderToStaticMarkup(
        createElement(EpisodeActions, {
          episodeId: "x", sharePath: "/episodes/x", shareBase: BASE_URL, isCreator: false, isHost: false, revealed: false,
          names: ["Cass Vega", "Rafe"], dramaQuestion: null, myPick: null, myDramaPick: null, dateNumber,
        }),
      );
    expect(picks(3)).toContain("A fourth date");
    expect(picks(3)).not.toContain("A second date");
    expect(picks(3)).toContain('value="second_date"'); // the pick sent stays second_date
    expect(picks(null)).toContain("A second date");
  });

  it("in the prompts: the third date's recap is told it ends in a fourth date, the first in a second", async () => {
    const { prompts } = await threeDates();
    expect(prompts[0]).toContain("Decided ending: A second date");
    expect(prompts[2]).toContain("Decided ending: A fourth date");
    expect(prompts[2]).not.toContain("Decided ending: A second date");
  });

  it("over MCP: the airing feed's just_aired labels each date by its own number", async () => {
    const { ids } = await threeDates();
    const read = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "botchelor://feed/airing" } }, {});
    const feed = JSON.parse((read as Any).result.contents[0].text);
    const label = (id: string) => feed.just_aired.find((e: Any) => e.episode_id === id)?.ending_label;
    expect(label(ids[2])).toBe("A fourth date");
    expect(label(ids[1])).toBe("A third date");
    expect(label(ids[0])).toBe("A second date");
    expect(feed.just_aired.find((e: Any) => e.episode_id === ids[2]).ending).toBe("second_date");
  });

  it("over MCP: browse_episodes and predict say how the picks read on a later date; the pick sent stays second_date", async () => {
    const { ids } = await threeDates({ airLast: false }); // their third date, not aired: open for predictions
    const rpc = async (method: string, params: Record<string, unknown>) => (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, {})) as Any;
    const call = async (name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args })).result.structuredContent;
    const open = await call("browse_episodes", { open: true });
    const listed = open.episodes.find((e: Any) => e.id === ids[2]);
    expect(listed.picks).toEqual({ second_date: "A fourth date", friends: "Just friends", disaster: "A disaster" });
    expect(listed.context.date_number).toBe(3);
    expect(JSON.stringify(listed.context)).not.toMatch(/friends|disaster/); // context still never names an ending
    const picked = await call("predict", { episode_id: ids[2], pick: "second_date" });
    expect(picked.prediction).toMatchObject({ pick: "second_date" });
    expect(picked.picks.second_date).toBe("A fourth date");
  });
});
