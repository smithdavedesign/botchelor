import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as syncRoute } from "@/app/api/watch-parties/[id]/sync/route";
import WatchRoom from "@/app/watch/[id]/WatchRoom";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { createTemplateParty, getRoomState, syncRoom } from "@/lib/watch";
import { episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf } from "./helpers";

// Open rooms start on a word, not a page load (the 2026-11-11 audit, 2.7: a browser-looking crawler loading /watch/<id>
// started a house date). The heartbeat's `start` says whether this join may start a waiting template room.

const A = HOUSE_CHARACTERS[0].id;
const B = HOUSE_CHARACTERS[1].id;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

async function templateRoom() {
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const result = await createTemplateParty(t.db, A, B);
  if (!result || !result.ok) throw new Error("template setup failed");
  return result.id;
}

const startsAtOf = async (id: string) => (await t.db.query<{ starts_at: Date | null }>(`select starts_at from watch_parties where id = $1`, [id])).rows[0].starts_at;

describe("syncRoom's `start`", () => {
  it("false marks the viewer present and leaves the clock alone; true starts it once; the default is still to start", async () => {
    const id = await templateRoom();
    const viewer = userIdOf(newUserCookie());
    const waiting = (await syncRoom(t.db, id, viewer, new Date(), { start: false }))!;
    expect(waiting.clock.started).toBe(false);
    expect(waiting.watching).toBe(1);
    expect(await startsAtOf(id)).toBeNull();

    const started = (await syncRoom(t.db, id, viewer, new Date(), { start: true }))!;
    expect(started.clock.started).toBe(true);
    const at = await startsAtOf(id);
    expect(at).not.toBeNull();
    await syncRoom(t.db, id, userIdOf(newUserCookie()), new Date(), { start: false });
    expect(new Date((await startsAtOf(id))!).getTime()).toBe(new Date(at!).getTime());

    // Library callers that say nothing (the lobby's Start, the tests, MCP) start the room as they always did.
    const other = await templateRoom();
    expect((await syncRoom(t.db, other, viewer))!.clock.started).toBe(true);
  });

  it("the route reads it from the body: `start: false` waits, anything else starts", async () => {
    const id = await templateRoom();
    const cookie = newUserCookie();
    const post = async (body: unknown) => {
      const req = new Request(`http://localhost/api/watch-parties/${id}/sync`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await syncRoute(req, { params: Promise.resolve({ id }) });
      return (await res.json()) as { clock: { started: boolean } };
    };
    expect((await post({ start: false })).clock.started).toBe(false);
    expect(await startsAtOf(id)).toBeNull();
    expect((await post({})).clock.started).toBe(true);
  });
});

describe("the room's page", () => {
  it("offers Start to a viewer who hasn't asked for the date, and counts down for one who has", async () => {
    const id = await templateRoom();
    const state = (await getRoomState(t.db, id, null))!;
    expect(state.clock.started).toBe(false);
    const cold = renderToStaticMarkup(createElement(WatchRoom, { initial: state, autoStart: false }));
    expect(cold).toContain("Start the date");
    expect(cold).toContain("Ready when you are");
    expect(cold).toContain("Anyone who joins in the next few minutes watches it with you.");
    const meant = renderToStaticMarkup(createElement(WatchRoom, { initial: state, autoStart: true }));
    expect(meant).not.toContain("Start the date");
    expect(meant).toContain("The date is about to start");
  });
});
