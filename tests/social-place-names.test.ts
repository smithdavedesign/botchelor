import { describe, expect, it } from "vitest";
import { isJobName, isTheirJob, workplaceName } from "@/lib/social/place-names";

// A workplace is a place, never a job (lib/social/place-names.ts, docs/PRDs/social-network.md section 6.2). The cases
// are the show's own: the 2026-11-21 backfill wrote 35 of its 110 workplaces as job titles.

describe("a workplace named for a job", () => {
  it("is the place the job is done, read from its words", () => {
    const read: [string, string][] = [
      // The words before the role, a role's own place word ("Officer": Office), down to the last word that names a place.
      ["Flat Pack Furniture Maze Manager", "Flat Pack Furniture Maze"],
      ["Lost Luggage Reunion Officer", "Lost Luggage Reunion Office"],
      ["Horticultural Consultant", "Horticultural Consultancy"],
      ["Marionette Theatre Director & Artisan", "Marionette Theatre"],
      ["Lunar Lighthouse Keeper", "Lunar Lighthouse"],
      ["County Courthouse Interpreter", "County Courthouse"],
      ["Surf School Instructor", "Surf School"],
      ["Jazz Club Booking Agent", "Jazz Club"],
      ["Freezer farm inventory auditor", "Freezer farm"],
      ["Senior Flat Pack Maze Supervisor", "Flat Pack Maze"],
      // The place after the role: "of" or a comma only before a place word, "for", "at" or "with" before a name too.
      ["Housekeeping supervisor for Channel 3's retro TV", "Channel 3's retro TV"],
      ["Trail Guide of the Lakeside Ruins", "The Lakeside Ruins"],
      ["Boundary Warden of the Wistful Glade", "The Wistful Glade"],
      ["Night porter, hospital linen room", "Hospital linen room"],
      ["Head of Sales at The Grand Hotel", "The Grand Hotel"],
    ];
    for (const [job, place] of read) expect([job, workplaceName(job)]).toEqual([job, { name: place, why: "a job, not a place: where it's done" }]);
  });

  it("is no workplace when no place can be read from it", () => {
    for (const job of [
      "Reindeer Herder's Assistant",
      "Royal Food Taster & Sensory Analyst",
      "Canoe Slalom Judge",
      "Herbologist",
      "Snow Patrol Co-ordinator",
      "Wandering Beekeeper and Road Guide",
      "Mountain Rescue Search-Dog Handler",
      "First Secretary of Inter-realm Diplomacy",
      "Professor of Nocturnal Studies",
      "Starship Galley Chief, IGS Retriever",
      "Writer for Hire",
    ]) {
      expect([job, workplaceName(job)]).toEqual([job, { name: null, why: "a job, not a place" }]);
    }
  });

  it("is the character's own job too, whatever its last word", () => {
    expect(isTheirJob("Contact Lens Fitter", "Contact lens fitter at a high street optician")).toBe(true);
    expect(isTheirJob("Hedge-trimmer", "Hedge-trimmer for the Vellmoor parish roads")).toBe(true);
    expect(isTheirJob("Royal Glasshouses", "Royal Glasshouses gardener")).toBe(false);
    expect(isTheirJob("Royal Glasshouses", null)).toBe(false);
    expect(workplaceName("Desalination Plant Chemist", { job: "Desalination plant chemist" })).toEqual({ name: "Desalination Plant", why: "their job, not a place: where it's done" });
    expect(workplaceName("Complaint Limericist", { job: "Complaint limericist" })).toEqual({ name: null, why: "their job, not a place" });
    expect(workplaceName("Eternal Diva, Spectral Soprano", { job: "Eternal Diva, Spectral Soprano" })).toEqual({ name: null, why: "their job, not a place" });
    // "Captain" names pubs as often as jobs: only the character's own job makes it one.
    expect(workplaceName("Captain of the Orison's Misfortune fleet")).toEqual({ name: "Captain of the Orison's Misfortune fleet", why: null });
    expect(workplaceName("Captain of the Orison's Misfortune fleet", { job: "Captain of the Orison's Misfortune fleet" }).name).toBe("The Orison's Misfortune fleet");
    expect(isJobName("Boatwright", "Boatwright")).toBe(true);
    expect(isJobName("Boatwright")).toBe(false);
  });
});

describe("a place's name", () => {
  it("comes back exactly as given", () => {
    for (const name of [
      "Flat Pack Furniture Maze",
      "The Cauldron Smoothie Bar",
      "Harbour Pilot's Guild",
      "Forest Warden's Office",
      "Officer's Mess",
      "Captain Vox's Corner",
      "Lightfoot Architects",
      "Flat-Pack Fixer",
      "The Silver Scribe",
      "Bayside Butcher",
      "Museum of Rosetta-Sands",
      "Echoes of Lakeside",
      "The Wandering Carnival of Serendip",
      "Whitaker & Sons Spectral Estates",
      "Map Whisperer's Emporium",
      "Heartsease-on-Sea Perfume Testing Co.",
      "Sunsails and Skyskippers",
      "Soup Station 2am",
      "Accordion Haven",
    ]) {
      expect([name, workplaceName(name)]).toEqual([name, { name, why: null }]);
      expect(isJobName(name)).toBe(false);
    }
  });

  it("is none when there's nothing, and a read one keeps within the cap", () => {
    expect(workplaceName("   ")).toEqual({ name: null, why: "no name" });
    const read = workplaceName("Grand Old Seaside Flat Pack Furniture Maze Manager", { max: 30 });
    expect(read.name!.length).toBeLessThanOrEqual(30);
    expect(read.name).toBe("Grand Old Seaside Flat Pack");
  });
});
