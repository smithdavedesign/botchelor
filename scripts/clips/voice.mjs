// Voices for the daily clip (the 2026-11-11 growth plan, David's call: Kokoro on Venice, about a cent a clip). The PG
// theater is silent, so the clip's lines are spoken here: one MP3 per line from Venice's tts-kokoro with the key from
// the keychain (vault/botchelor/VENICE_API_KEY), macOS `say` when Venice is down, then one track that places each line
// where its bubble appeared in the recording (daily-clip.mjs marks the moment). Pure helpers first, I/O after.
//   fitPlan(marks, durations)  → where each line starts and how it's trimmed to its slot (tested)
//   mixArgs(plan, files, total) → the ffmpeg filter that lays the lines on one silent bed (tested)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Kokoro's stock voices, as lib/voice.ts picks them: by pronoun, then a hash of the id, so a character keeps one voice. */
export const VOICES = {
  she: ["af_bella", "af_nicole", "af_sarah", "af_heart", "af_nova", "af_jessica", "af_kore", "af_aoede"],
  he: ["am_onyx", "am_michael", "am_adam", "am_eric", "am_liam", "am_fenrir", "am_echo", "am_puck"],
  they: ["af_river", "am_echo", "af_sky", "am_liam"],
};

/** A character's voice from its pronouns (the public episode JSON carries them) and id; "they" when unknown. */
export function voiceFor(c) {
  const p = String(c.pronouns ?? "").toLowerCase();
  const list = p.startsWith("she") ? VOICES.she : p.startsWith("he") ? VOICES.he : VOICES.they;
  let h = 0;
  for (const ch of String(c.id ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** What a line says out loud: every *action* out, the rest tidied, at most 600 characters (lib/voice.ts sayable). */
export function sayable(text) {
  return String(text ?? "")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/** A line may run this much faster than it was spoken before it's cut instead. */
export const TEMPO_MAX = 1.25;
/** The fade at the end of a line that had to be cut. */
export const CUT_FADE_S = 0.15;

/**
 * Where each spoken line goes (pure). `marks[i]` is when line i's bubble appeared, in seconds of the video; the slot a
 * line has runs to the next mark (the last to `end`). A line longer than its slot plays up to TEMPO_MAX faster, and
 * what still doesn't fit is cut with a short fade, so two lines never overlap. Lines with no audio (an action-only line)
 * are skipped.
 */
export function fitPlan(marks, durations, end) {
  const plan = [];
  for (let i = 0; i < marks.length; i++) {
    const dur = durations[i];
    if (!(dur > 0)) continue;
    const next = marks[i + 1] ?? end ?? marks[i] + dur;
    const slot = Math.max(0.3, next - marks[i] - 0.1);
    const tempo = dur <= slot ? 1 : Math.min(TEMPO_MAX, dur / slot);
    const played = dur / tempo;
    plan.push({ index: i, start: marks[i], tempo, trimTo: played > slot ? slot : null });
  }
  return plan;
}

/**
 * ffmpeg's -filter_complex for the voice track (pure): each line sped up as planned, cut and faded when it must be,
 * delayed to its start, all mixed on one bed and padded to the video's length. Inputs are the line files in plan order.
 */
export function mixArgs(plan, total) {
  const parts = plan.map((p, i) => {
    const ops = [];
    if (p.tempo !== 1) ops.push(`atempo=${p.tempo.toFixed(3)}`);
    if (p.trimTo !== null) ops.push(`atrim=0:${p.trimTo.toFixed(3)}`, `afade=t=out:st=${Math.max(0, p.trimTo - CUT_FADE_S).toFixed(3)}:d=${CUT_FADE_S}`);
    ops.push("aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo", `adelay=${Math.round(p.start * 1000)}|${Math.round(p.start * 1000)}`);
    return `[${i}:a]${ops.join(",")}[l${i}]`;
  });
  const mix = plan.length ? `${plan.map((_, i) => `[l${i}]`).join("")}amix=inputs=${plan.length}:normalize=0:dropout_transition=0,` : "anullsrc=r=48000:cl=stereo,";
  return `${parts.join(";")}${parts.length ? ";" : ""}${mix}apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[a]`;
}

/** The Venice key from the keychain, or null (then `say`). Never printed. */
export function veniceKey() {
  try {
    return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/VENICE_API_KEY", "-w"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** One line as MP3 from Venice's Kokoro; throws when Venice won't. */
export async function veniceLine(words, voice, file, key) {
  const res = await fetch("https://api.venice.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "tts-kokoro", input: words, voice, response_format: "mp3", speed: 1 }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Venice ${res.status}: ${(await res.text()).slice(0, 160)}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** One line from macOS `say` (free, plainer), as M4A ffmpeg takes. */
export function sayLine(words, pronouns, file) {
  const voice = String(pronouns ?? "").toLowerCase().startsWith("he") ? "Daniel" : "Samantha";
  const aiff = `${file}.aiff`;
  execFileSync("say", ["-v", voice, "-o", aiff, words]);
  execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "aac", "-b:a", "96k", file]);
}

/** A sound file's length in seconds, by ffprobe. */
export function soundSeconds(file) {
  const out = execFileSync(process.env.FFPROBE || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim();
  return Number(out) || 0;
}

/**
 * Speak the clip's lines: `lines` are {side, text} in order, `characters` the two (with id, pronouns). Returns one file
 * per line (null where the line says nothing) and which engine spoke. Venice first; `say` for the rest when Venice
 * fails or there's no key; SAY=1 forces `say`.
 */
export async function speakLines(lines, characters, dir, { log = console.error } = {}) {
  const key = process.env.SAY === "1" ? null : veniceKey();
  let engine = key ? "kokoro" : "say";
  const files = [];
  for (let i = 0; i < lines.length; i++) {
    const words = sayable(lines[i].text);
    if (!words) {
      files.push(null);
      continue;
    }
    const who = lines[i].side === "a" ? characters[0] : characters[1];
    const file = join(dir, `line${String(i).padStart(3, "0")}.${engine === "kokoro" ? "mp3" : "m4a"}`);
    try {
      if (engine === "kokoro") await veniceLine(words, voiceFor(who), file, key);
      else sayLine(words, who?.pronouns, file);
      files.push(file);
    } catch (e) {
      if (engine === "kokoro") {
        log(`voice: Venice failed (${e.message}); the rest on macOS say`);
        engine = "say";
        i--; // this line again, spoken by say
        continue;
      }
      log(`voice: line ${i} skipped (${e.message})`);
      files.push(null);
    }
  }
  return { files, engine };
}

/** The voice track for a recording: lines spoken, placed at their marks, one AAC file. Returns its path and engine. */
export async function voiceTrack({ lines, characters, marks, totalSeconds, dir, log }) {
  const { files, engine } = await speakLines(lines, characters, dir, { log });
  const durations = files.map((f) => (f ? soundSeconds(f) : 0));
  const plan = fitPlan(marks, durations, totalSeconds).filter((p) => files[p.index]);
  const track = join(dir, "voices.m4a");
  const inputs = plan.flatMap((p) => ["-i", files[p.index]]);
  execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", ...inputs, ...(plan.length ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]), "-filter_complex", mixArgs(plan, totalSeconds), "-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", track]);
  return { track, engine, spoken: plan.length };
}

/** For a quick look: the marks and durations a recording produced. */
export function readMarks(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
