/**
 * Venue sound beds (2026-11-28, Dave's "do 1-6", item 6): a quiet room tone under the date theater, by the kind of
 * place it is: waves on a beach, a restaurant's murmur and the odd glass, a club's thump through the wall, rain on a
 * tent, wind up a hill, a low hum anywhere else. Drawn live by the Web Audio API like the cues (app/motion/cues.ts), so
 * there's nothing to load, and only while the site's sound is on: off by default, the same one switch.
 */
import { audio, soundOn } from "./cues";

export type BedKind = "waves" | "murmur" | "club" | "rain" | "wind" | "hum";

const BEDS: Record<BedKind, readonly string[]> = {
  waves: ["night_beach", "surf_lesson", "pier_at_night", "swan_pedalo"],
  murmur: [
    "corner_cafe",
    "tasting_menu",
    "late_night_diner",
    "cooking_class",
    "jazz_bar",
    "rooftop_bar",
    "dive_bar",
    "comedy_club",
    "double_date",
    "night_market",
    "museum_night",
    "late_bookshop",
    "pottery_class",
    "murder_mystery",
    "ballroom_lesson",
    "old_cinema",
  ],
  club: ["nightclub", "silent_disco", "karaoke_booth", "retro_arcade", "bowling_alley", "ice_rink"],
  rain: ["rainy_campsite", "laundromat"],
  wind: ["hot_air_balloon", "skydive", "stargazing_hill", "botanic_park", "countryside_picnic", "trail_ride", "city_walk", "safari", "goat_yoga", "climbing_wall", "paintball"],
  hum: [],
};

/** The bed for a place: its library venue's kind (a place id like "night_beach@…" by its venue), else the hum. */
export function bedFor(place: string | null | undefined): BedKind {
  const id = (place ?? "").split("@")[0];
  for (const kind of Object.keys(BEDS) as BedKind[]) if (BEDS[kind].includes(id)) return kind;
  return "hum";
}

/** How loud a bed sits: well under a voice or a cue. */
const LEVEL = 0.05;

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  // Pink-ish: a running average takes the hiss off white noise.
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = 0.97 * last + 0.03 * (Math.random() * 2 - 1) * 6;
    data[i] = Math.max(-1, Math.min(1, last));
  }
  return buf;
}

/**
 * Starts a bed and returns its stop (which fades it out). Nothing, and a no-op stop, when sound is off or there's no
 * audio here: every bed fails silently, like the cues.
 */
export function startBed(kind: BedKind): () => void {
  if (typeof window === "undefined" || !soundOn()) return () => {};
  try {
    const c = audio();
    if (!c) return () => {};
    const t = c.currentTime;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(LEVEL, t + 2.5);
    master.connect(c.destination);
    const nodes: AudioScheduledSourceNode[] = [];
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 4);
    src.loop = true;
    const filter = c.createBiquadFilter();
    const shape = c.createGain();
    src.connect(filter).connect(shape).connect(master);
    nodes.push(src);
    // A slow swell on the bed itself (the waves coming in, the wind gusting, the room breathing).
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.connect(depth).connect(shape.gain);
    nodes.push(lfo);
    let tick: ReturnType<typeof setInterval> | null = null;
    switch (kind) {
      case "waves":
        filter.type = "lowpass";
        filter.frequency.value = 700;
        shape.gain.value = 0.7;
        lfo.frequency.value = 0.11;
        depth.gain.value = 0.55;
        break;
      case "wind":
        filter.type = "bandpass";
        filter.frequency.value = 420;
        filter.Q.value = 0.6;
        shape.gain.value = 0.8;
        lfo.frequency.value = 0.07;
        depth.gain.value = 0.5;
        break;
      case "rain":
        filter.type = "highpass";
        filter.frequency.value = 1800;
        shape.gain.value = 0.55;
        lfo.frequency.value = 0.3;
        depth.gain.value = 0.08;
        break;
      case "murmur":
        // A room's chatter sits in the voice band; now and then a glass or a fork.
        filter.type = "bandpass";
        filter.frequency.value = 520;
        filter.Q.value = 0.9;
        shape.gain.value = 0.9;
        lfo.frequency.value = 0.4;
        depth.gain.value = 0.25;
        tick = setInterval(() => {
          if (Math.random() > 0.35) return;
          const at = c.currentTime + Math.random() * 0.5;
          const o = c.createOscillator();
          const g = c.createGain();
          o.frequency.value = 2400 + Math.random() * 1600;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.06, at + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
          o.connect(g).connect(master);
          o.start(at);
          o.stop(at + 0.3);
        }, 1800);
        break;
      case "club": {
        // The bass through the wall: a soft kick on the beat, the room muffled around it.
        filter.type = "lowpass";
        filter.frequency.value = 260;
        shape.gain.value = 0.35;
        lfo.frequency.value = 0.2;
        depth.gain.value = 0.05;
        const beat = 60 / 118;
        let next = c.currentTime + 0.1;
        tick = setInterval(() => {
          while (next < c.currentTime + 0.6) {
            const o = c.createOscillator();
            const g = c.createGain();
            o.frequency.setValueAtTime(110, next);
            o.frequency.exponentialRampToValueAtTime(45, next + 0.12);
            g.gain.setValueAtTime(0.0001, next);
            g.gain.exponentialRampToValueAtTime(0.5, next + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, next + 0.3);
            o.connect(g).connect(master);
            o.start(next);
            o.stop(next + 0.35);
            next += beat;
          }
        }, 250);
        break;
      }
      case "hum": {
        filter.type = "lowpass";
        filter.frequency.value = 320;
        shape.gain.value = 0.45;
        lfo.frequency.value = 0.05;
        depth.gain.value = 0.15;
        const drone = c.createOscillator();
        const dg = c.createGain();
        drone.frequency.value = 55;
        dg.gain.value = 0.12;
        drone.connect(dg).connect(master);
        nodes.push(drone);
        break;
      }
    }
    for (const n of nodes) n.start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (tick) clearInterval(tick);
      try {
        const end = c.currentTime;
        master.gain.cancelScheduledValues(end);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), end);
        master.gain.exponentialRampToValueAtTime(0.0001, end + 0.8);
        for (const n of nodes) n.stop(end + 0.9);
      } catch {
        /* already gone */
      }
    };
  } catch {
    return () => {};
  }
}
