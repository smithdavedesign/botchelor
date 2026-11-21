import { describe, expect, it } from "vitest";
import { CLUSTER_NAME_SHARE, clusterLabel, clusterLine, clusterWords, membersByCommunity, nameClusters, namesThatFit, type PlaceGroup } from "@/lib/social/cluster-names";

// Clusters named after their places (lib/social/cluster-names.ts): "Regulars at the dive bar", "The Leeds lot".

const place = (key: string, role: PlaceGroup["role"], name: string, members: string[]): PlaceGroup => ({ key, role, name, members });

describe("cluster names", () => {
  it("says a place the way its people share it", () => {
    expect(clusterWords("regular", "the dive bar")).toBe("Regulars at the dive bar");
    expect(clusterWords("from", "Leeds")).toBe("The Leeds lot");
    expect(clusterWords("lives", "the Old Town")).toBe("The Old Town lot");
    expect(clusterWords("works", "Bean There")).toBe("The Bean There crew");
    expect(clusterWords("studied", "Westbrook Academy")).toBe("Classmates from Westbrook Academy");
    // The show's hangouts are named like descriptions: their article goes lower case, or drops where the words bring one.
    expect(clusterWords("regular", "A rooftop bar at golden hour")).toBe("Regulars at a rooftop bar at golden hour");
    expect(clusterWords("works", "A corner café that closes in an hour")).toBe("The corner café that closes in an hour crew");
  });

  it("names a cluster after the place most of it shares, anchored by its first members who share it", () => {
    const clusters = new Map([
      [0, ["d", "a", "b", "c"]],
      [1, ["e", "f", "g"]],
    ]);
    const names = nameClusters(clusters, [place("bar:regular", "regular", "the dive bar", ["a", "b", "c", "x"]), place("leeds:from", "from", "Leeds", ["e", "f"])]);
    expect(names.get(0)).toMatchObject({ words: "Regulars at the dive bar", key: "bar:regular", shared: 3, size: 4, anchors: ["a", "b", "c"] });
    expect(names.get(1)).toMatchObject({ words: "The Leeds lot", shared: 2, size: 3, anchors: ["e", "f"] });
  });

  it("leaves a cluster its number when no place covers enough of it", () => {
    const clusters = new Map([[0, ["a", "b", "c", "d", "e", "f"]]]);
    // Two of six share the bar: under the share a name needs.
    expect(2 / 6).toBeLessThan(CLUSTER_NAME_SHARE);
    expect(nameClusters(clusters, [place("bar:regular", "regular", "the dive bar", ["a", "b"])]).size).toBe(0);
    // One member alone never names anything.
    expect(nameClusters(new Map([[0, ["a", "b"]]]), [place("bar:regular", "regular", "the dive bar", ["a", "z"])]).size).toBe(0);
    expect(clusterLabel(0, new Map())).toBe("Cluster 1");
    expect(clusterLabel(2, null)).toBe("Cluster 3");
  });

  it("gives a place to one cluster only, the one it fits best; the other takes its next best", () => {
    const clusters = new Map([
      [0, ["a", "b", "c"]],
      [1, ["d", "e", "f"]],
    ]);
    const names = nameClusters(clusters, [place("bar:regular", "regular", "the dive bar", ["a", "b", "c", "d", "e"]), place("leeds:from", "from", "Leeds", ["d", "e"])]);
    expect(names.get(0)?.words).toBe("Regulars at the dive bar");
    expect(names.get(1)?.words).toBe("The Leeds lot");
    expect(clusterLabel(1, names)).toBe("The Leeds lot");
    // A star's panel says it's their cluster's name, not a fact about them; an unnamed one keeps its number.
    expect(clusterLine(1, names)).toBe("Their cluster: The Leeds lot");
    expect(clusterLine(4, names)).toBe("Cluster 5");
  });

  it("counts characters only, never a view's place stars or a private star", () => {
    const by = membersByCommunity([
      { id: "a", community: 0 },
      { id: "b", community: 0, private: true },
      { id: "place:1", community: 0, place: { words: "x" } },
      { id: "c", community: null },
      { id: "d", community: 1 },
    ]);
    expect([...by.entries()]).toEqual([
      [0, ["a"]],
      [1, ["d"]],
    ]);
  });

  it("keeps a server's name only while its anchors on this sky still sit in the cluster it names", () => {
    const name = { community: 0, words: "The Leeds lot", key: "leeds:from", shared: 3, size: 5, anchors: ["a", "b", "c"] };
    // Two of its anchors on a first sky, both in cluster 0: it fits.
    expect(namesThatFit([name], [{ id: "a", community: 0 }, { id: "c", community: 0 }, { id: "z", community: 1 }]).get(0)?.words).toBe("The Leeds lot");
    // A newer build moved one of them: the numbers changed under it, so it's dropped.
    expect(namesThatFit([name], [{ id: "a", community: 0 }, { id: "b", community: 1 }]).size).toBe(0);
    // None of its anchors on this sky: nothing to check it by.
    expect(namesThatFit([name], [{ id: "z", community: 0 }]).size).toBe(0);
  });
});
