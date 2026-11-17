import { z } from "zod";
import { adultModel, adultViewer } from "@/lib/adult/mode";
import { hardNoHit, hasHardNos } from "@/lib/adult/limits";
import { adultNarratedOpen, sceneLineToNarrate } from "@/lib/adult/narrate-scene";
import { limitsOf, listNights, openScene } from "@/lib/adult/scenes";
import { countUse, overCap } from "@/lib/adult/usage";
import { FALLBACK_WRITER } from "@/lib/adult/writer-config";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { adultStory } from "@/lib/stories";

const id = z.string().min(1).max(200);
const Input = z.object({ a: id, b: id, chapter: id, make: z.boolean().optional() });

/**
 * An After Dark chapter told as a story (lib/stories.ts): one of the viewer's saved chapters (its id), or tonight's as far
 * as it's written ("now"). Made once and kept; it counts one of the month's scene steps, like any other step. Open to
 * admins, and to everyone once the "narrated" rollout switch says so: anyone else, or anyone After Dark is closed to,
 * gets the same 404.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  const hidden = () => json({ error: "not_found" }, 404);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const scene = await openScene(db, viewer, input.a, input.b);
  if (!scene) return hidden();
  let lines = scene.lines;
  let ref = `${scene.id}:${scene.chapter}:${scene.lines.length}`;
  let place = scene.set_place ?? scene.place;
  if (input.chapter !== "now") {
    const night = (await listNights(db, viewer, input.a, input.b)).find((n) => n.id === input.chapter);
    if (!night) return hidden();
    lines = night.lines;
    ref = night.id;
    place = night.set_place ?? night.place;
  }
  const limits = limitsOf(scene);
  const names = { a: scene.a.name, b: scene.b.name };
  const short = { a: names.a.split(/\s+/)[0], b: names.b.split(/\s+/)[0] };
  const r = await adultStory(
    db,
    viewer,
    {
      ref,
      names,
      place,
      context: input.chapter === "now" ? scene.recap : null,
      lines: lines.map((l) => sceneLineToNarrate(l, short)),
      ...(hasHardNos(limits.hard_nos) ? { extra: (t: string) => hardNoHit(t, limits.hard_nos) } : {}),
    },
    {
      model: await adultModel(db, process.env, { model: FALLBACK_WRITER }),
      make: input.make !== false,
      open: await adultNarratedOpen(db, viewer),
      // The month's scene steps (lib/adult/usage.ts): refused when they're used, counted when there's room.
      charge: async (n) => {
        if (n <= 0) return null;
        const capped = await overCap(db, viewer, "writes");
        if (capped) return capped;
        await countUse(db, viewer, "writes", undefined, n);
        return null;
      },
      giveBack: async (n) => {
        if (n > 0) await countUse(db, viewer, "writes", undefined, -n);
      },
    },
  );
  return r.ok ? json({ story: r.story, made: r.made }) : json({ error: r.error, message: r.message }, r.status);
});

