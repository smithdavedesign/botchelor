import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getClusters } from "@/app/api/graph/clusters/route";
import { setDbForTests } from "@/lib/db";
import type { GraphData, GraphNode } from "@/lib/graph";
import { loveClusterNames } from "@/lib/social/cluster-sky";
import { ensurePlace, setMembership } from "@/lib/social/places";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The Love view's clusters named after their places (lib/social/cluster-sky.ts, /api/graph/clusters): its clusters are
// the Constellation's, its places the ones the public cast share in public.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ID = (k: string) => `cs-${k}`;
const owner = userIdOf(newUserCookie());
async function character(k: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, avatar_hue, extras)
     values ($1, $2, false, $3, 30, 'Keeps bees and opinions.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, 120, '{}'::jsonb)`,
    [ID(k), owner, `Cluster ${k[0].toUpperCase()}${k.slice(1)}`, visibility],
  );
}
const star = (k: string, community: number | null, degree: number, priv = false): GraphNode => ({
  id: ID(k),
  name: k,
  hue: null,
  origin: null,
  portrait: null,
  private: priv,
  degree,
  kind: null,
  kind_label: null,
  community,
});

describe("Love's clusters, named", () => {
  it("names each after the place most of it shares in public, its best connected first as anchors", async () => {
    for (const k of ["ada", "bea", "cal", "dee", "eve", "fay"]) await character(k);
    await character("zed", "private");
    const dive = (await ensurePlace(t.db, { key: "cs-dive", kind: "venue", name: "the dive bar", source: "admin" })).id;
    const leeds = (await ensurePlace(t.db, { key: "cs-leeds", kind: "hometown", name: "Leeds", source: "admin" })).id;
    for (const k of ["cal", "ada", "bea"]) await setMembership(t.db, { placeId: dive, characterId: ID(k), role: "regular", source: "admin" });
    for (const k of ["dee", "eve"]) await setMembership(t.db, { placeId: leeds, characterId: ID(k), role: "from", source: "owner" });
    // Kept to their owner, or a private character's: neither counts.
    await setMembership(t.db, { placeId: leeds, characterId: ID("fay"), role: "from", source: "owner", visibility: "owner" });
    await setMembership(t.db, { placeId: leeds, characterId: ID("zed"), role: "from", source: "owner" });

    const data = {
      nodes: [star("cal", 0, 1), star("ada", 0, 3), star("bea", 0, 2), star("fay", 1, 4), star("eve", 1, 1), star("dee", 1, 2), star("zed", null, 1, true)],
    } as GraphData;
    const named = (await loveClusterNames(t.db, { data }))!;
    expect(named.names).toEqual([
      { community: 0, words: "Regulars at the dive bar", key: `${dive}:regular`, shared: 3, size: 3, anchors: [ID("ada"), ID("bea"), ID("cal")] },
      // Two of three from Leeds: Fay's own hometown is kept to her owner, so she isn't counted, but she's still in the cluster.
      { community: 1, words: "The Leeds lot", key: `${leeds}:from`, shared: 2, size: 3, anchors: [ID("dee"), ID("eve")] },
    ]);
    expect(JSON.stringify(named)).not.toContain(ID("zed"));
  });

  it("is served for the key, and is nothing with the views off", async () => {
    const res = await getClusters(new Request(`${BASE_URL}/api/graph/clusters`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { names: unknown[] }).names).toEqual([]);

    vi.stubEnv("SOCIAL_LENSES", "0");
    expect(await loveClusterNames(t.db, { data: { nodes: [] } as unknown as GraphData })).toBeNull();
    expect((await getClusters(new Request(`${BASE_URL}/api/graph/clusters`))).status).toBe(404);
  });
});
