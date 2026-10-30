/**
 * ffmpeg on the server, back for the creator tools (David, 2026-10-26: "save a image or offering a boomerang for a clip
 * … continue where it left off"). #688 took it out when a night's shots stopped chaining from each other's last frames;
 * now a clip's moment is cut from our own copy of it (a video never leaves our servers: signed links are for pictures),
 * and a boomerang or a loop is made from the clip's own frames. The binary (ffmpeg-static) ships only with the routes
 * that use it (next.config.ts). Each run works in a temp folder of its own, removed after, with a time limit.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AI_DESCRIPTION, markAiVideo } from "../ai-mark";
import { badgePng, cropBox, EXPORT_SIZES, type ExportSize } from "./image";

/** A video's trim (lib/adult/trim.ts): where it starts and ends, and the parts cut out, in seconds. */
export type KeptTrim = { start: number; end: number | null; cuts: [number, number][] };

export class FfmpegError extends Error {}

/** One run: its arguments (after -hide_banner), the files it reads (written to its folder first), the ones it writes. */
export type FfmpegRun = { args: string[]; inputs: Record<string, Buffer>; outputs: string[]; timeoutMs?: number; quiet?: boolean; allowFail?: boolean };
export type FfmpegResult = { files: Record<string, Buffer>; stderr: string };
type Runner = (run: FfmpegRun) => Promise<FfmpegResult>;

let runnerForTests: Runner | null = null;
/** Tests that don't need ffmpeg itself stand in for it (the moments' own tests run the real one). */
export function setFfmpegForTests(r: Runner | null): void {
  runnerForTests = r;
}

/**
 * Where the binary is: FFMPEG_PATH when it's set (a system ffmpeg), else ffmpeg-static's. The package is loaded by a name
 * made at run time, never imported by its name: ffmpeg-static says where its binary is with path.join(__dirname,
 * "ffmpeg"), which the build's file tracer follows into every route that imports this file, however far away (2026-10-26:
 * the ~75 MB binary in 236 of 247 routes, and production's deploy ran out of disk). The binary ships with the one route
 * that runs it (next.config.ts outputFileTracingIncludes; tests/media-tools-tracing.test.ts holds it there).
 */
async function binary(): Promise<string> {
  const own = process.env.FFMPEG_PATH;
  if (own) return own;
  const name = ["ffmpeg", "static"].join(String.fromCharCode(45));
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as { default?: string | null };
  const path = mod.default ?? null;
  if (!path) throw new FfmpegError("ffmpeg isn't available on this server");
  return path;
}

export async function runFfmpeg(run: FfmpegRun): Promise<FfmpegResult> {
  if (runnerForTests) return runnerForTests(run);
  const dir = await mkdtemp(join(tmpdir(), "bz-ffmpeg-"));
  try {
    for (const [name, bytes] of Object.entries(run.inputs)) await writeFile(join(dir, name), bytes);
    const bin = await binary();
    const args = ["-hide_banner", ...(run.quiet === false ? [] : ["-loglevel", "error"]), ...run.args];
    const stderr = await new Promise<string>((resolve, reject) => {
      // turbopackIgnore: the tracer otherwise reads this call as touching any file and ships the whole project with the
      // route (2026-10-30, DigitalOcean's build warned exactly that).
      execFile(/* turbopackIgnore: true */ bin, args, { cwd: dir, timeout: run.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, _out, errOut) => {
        if (err && !run.allowFail) {
          const said = String(errOut || err.message).trim();
          // The binary missing from a deployment is the one worth spotting in the runtime logs.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") console.error(`[ffmpeg] no binary at ${bin}`);
          reject(new FfmpegError(said.slice(-300) || "ffmpeg failed"));
        } else resolve(String(errOut ?? ""));
      });
    });
    const files: Record<string, Buffer> = {};
    for (const name of run.outputs) files[name] = await readFile(join(dir, name));
    return { files, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** What a video is: its length in seconds, its frame's size, and whether it has sound. */
export type VideoInfo = { duration: number; w: number; h: number; audio: boolean };

/** A video's length, size and sound, read from what ffmpeg says about its input (ffmpeg-static ships no ffprobe). */
export async function videoInfo(video: Buffer): Promise<VideoInfo> {
  const { stderr } = await runFfmpeg({ args: ["-i", "in.mp4"], inputs: { "in.mp4": video }, outputs: [], quiet: false, allowFail: true, timeoutMs: 20_000 });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d) throw new FfmpegError("couldn't read the clip's length");
  const size = /Stream #[^\n]*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
  return {
    duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    w: size ? Number(size[1]) : 0,
    h: size ? Number(size[2]) : 0,
    audio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

/** A video's length in seconds. */
export async function videoDuration(video: Buffer): Promise<number> {
  return (await videoInfo(video)).duration;
}

/** The shortest stretch kept, and the shortest loop worth making. */
const MIN_PART = 0.1;

/** The stretches a trim keeps, in order, inside the video's length (the whole video when there's no trim). */
export function keptParts(duration: number, trim?: KeptTrim | null): [number, number][] {
  const end = Math.min(trim?.end ?? duration, duration);
  let at = Math.min(Math.max(0, trim?.start ?? 0), end);
  const parts: [number, number][] = [];
  for (const [a, b] of [...(trim?.cuts ?? [])].sort((x, y) => x[0] - y[0])) {
    if (a > at) parts.push([at, Math.min(a, end)]);
    at = Math.max(at, b);
  }
  if (end > at) parts.push([at, end]);
  return parts.filter(([a, b]) => b - a >= MIN_PART);
}

const lengthOf = (parts: readonly [number, number][]) => parts.reduce((n, [a, b]) => n + (b - a), 0);
const sec = (n: number) => n.toFixed(3);

/**
 * The filter graph that plays only what's kept, at an even size and a steady 24 fps (what xfade and the encoder want),
 * into the label `[base]`.
 */
function keptGraph(parts: readonly [number, number][], opts: { audio?: boolean } = {}): string {
  const pieces = parts.map(([a, b], k) => `[0:v]trim=start=${sec(a)}:end=${sec(b)},setpts=PTS-STARTPTS[p${k}]`);
  // With its sound (an export of a clip that has some): the same stretches of it, into `[abase]`.
  const sounds = opts.audio ? parts.map(([a, b], k) => `[0:a]atrim=start=${sec(a)}:end=${sec(b)},asetpts=PTS-STARTPTS[s${k}]`) : [];
  const n = parts.length;
  if (opts.audio) {
    const joined = `${parts.map((_, k) => `[p${k}][s${k}]`).join("")}concat=n=${n}:v=1:a=1[kept][abase]`;
    return [...pieces, ...sounds, joined, `[kept]fps=24,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2[base]`].join(";");
  }
  const joined = n > 1 ? `${parts.map((_, k) => `[p${k}]`).join("")}concat=n=${n}:v=1:a=0[kept]` : null;
  const into = joined ? "kept" : "p0";
  return [...pieces, ...(joined ? [joined] : []), `[${into}]fps=24,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2[base]`].join(";");
}

/** How every video made here is written: H.264 that plays anywhere, silent, starting fast, and marked AI-generated. */
const VIDEO_OUT = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-metadata", `comment=${AI_DESCRIPTION}`, "-metadata", `description=${AI_DESCRIPTION}`];

/**
 * One frame of a video as a PNG: at `at` seconds, or at the end of what its trim keeps ("end"). Returns the time it was
 * cut at too, held inside the video.
 */
export async function frameAt(video: Buffer, at: number | "end", trim?: KeptTrim | null): Promise<{ png: Buffer; at: number }> {
  const duration = await videoDuration(video);
  const parts = keptParts(duration, trim);
  const last = parts.length ? parts[parts.length - 1][1] : duration;
  // A frame a little before the very end: the last one can be missing from a seek.
  const t = at === "end" ? Math.max(0, last - 0.08) : Math.min(Math.max(0, at), Math.max(0, duration - 0.08));
  const { files } = await runFfmpeg({
    args: ["-ss", sec(t), "-i", "in.mp4", "-frames:v", "1", "-update", "1", "-y", "frame.png"],
    inputs: { "in.mp4": video },
    outputs: ["frame.png"],
    timeoutMs: 20_000,
  });
  const png = files["frame.png"];
  if (!png?.length) throw new FfmpegError("no frame came out");
  return { png, at: Math.round(t * 100) / 100 };
}

/** A boomerang: what the trim keeps, played forward and then backward, silent. */
export async function boomerang(video: Buffer, trim?: KeptTrim | null): Promise<Buffer> {
  const parts = keptParts(await videoDuration(video), trim);
  if (!parts.length) throw new FfmpegError("nothing is left of the clip to play");
  const graph = `${keptGraph(parts)};[base]split[f][r0];[r0]reverse[r];[f][r]concat=n=2:v=1:a=0[out]`;
  const { files } = await runFfmpeg({ args: ["-i", "in.mp4", "-filter_complex", graph, "-map", "[out]", ...VIDEO_OUT, "-y", "out.mp4"], inputs: { "in.mp4": video }, outputs: ["out.mp4"] });
  return files["out.mp4"];
}

/**
 * A seamless loop: the end of what's kept fades into its start, so played on repeat there's no jump. The first `fade`
 * seconds are laid over the last: the result is `fade` shorter, and ends on the very frame it starts on.
 */
export async function seamlessLoop(video: Buffer, trim?: KeptTrim | null, fade = 0.6): Promise<Buffer> {
  const parts = keptParts(await videoDuration(video), trim);
  const length = lengthOf(parts);
  if (length < 1) throw new FfmpegError("the clip is too short to loop");
  const f = Math.min(fade, length / 4);
  const graph = `${keptGraph(parts)};[base]split[m0][h0];[m0]trim=start=${sec(f)},setpts=PTS-STARTPTS[m];[h0]trim=end=${sec(f)},setpts=PTS-STARTPTS[h];[m][h]xfade=transition=fade:duration=${sec(f)}:offset=${sec(length - 2 * f)}[out]`;
  const { files } = await runFfmpeg({ args: ["-i", "in.mp4", "-filter_complex", graph, "-map", "[out]", ...VIDEO_OUT, "-y", "out.mp4"], inputs: { "in.mp4": video }, outputs: ["out.mp4"] });
  return files["out.mp4"];
}

/**
 * A clip as it's exported (lib/media-tools/export.ts): what its trim keeps, at a social size (cut to its shape a quarter
 * of the way down, like a picture, and never enlarged) or its own, with the "AI" badge laid over it or not, and its
 * sound when it has some. Untrimmed, at its own size, without the badge, it isn't re-encoded at all. Marked AI-generated
 * (an XMP box, as every MP4 kept is).
 */
export async function exportVideo(video: Buffer, opts: { size: ExportSize; trim?: KeptTrim | null; badge?: boolean }): Promise<Buffer> {
  const trimmed = Boolean(opts.trim && (opts.trim.start > 0 || opts.trim.end !== null || opts.trim.cuts.length));
  if (opts.size === "original" && !trimmed && !opts.badge) return markAiVideo(video);
  const info = await videoInfo(video);
  const parts = keptParts(info.duration, opts.trim);
  if (!parts.length) throw new FfmpegError("nothing is left of the clip to export");
  const even = (n: number) => Math.max(2, n - (n % 2));
  let w = even(info.w || 720);
  let h = even(info.h || 960);
  const steps: string[] = [keptGraph(parts, { audio: info.audio })];
  let last = "base";
  if (opts.size !== "original") {
    const target = EXPORT_SIZES[opts.size];
    const box = cropBox(w, h, target.w, target.h);
    const scale = Math.min(1, target.w / box.width);
    const cw = even(box.width);
    const ch = even(box.height);
    w = even(Math.round(cw * scale));
    h = even(Math.round(ch * scale));
    steps.push(`[base]crop=${cw}:${ch}:${box.left}:${box.top},scale=${w}:${h}[sized]`);
    last = "sized";
  }
  const inputs: Record<string, Buffer> = { "in.mp4": video };
  const args = ["-i", "in.mp4"];
  if (opts.badge) {
    inputs["badge.png"] = await badgePng(w, h, opts.size);
    args.push("-i", "badge.png");
    steps.push(`[${last}][1:v]overlay=0:0[out]`);
    last = "out";
  }
  const sound = info.audio ? ["-map", "[abase]", "-c:a", "aac", "-b:a", "128k"] : [];
  const out = VIDEO_OUT.filter((a) => a !== "-an");
  const { files } = await runFfmpeg({
    args: [...args, "-filter_complex", steps.join(";"), "-map", `[${last}]`, ...sound, ...(info.audio ? out : VIDEO_OUT), "-y", "out.mp4"],
    inputs,
    outputs: ["out.mp4"],
    timeoutMs: 90_000,
  });
  return markAiVideo(files["out.mp4"]);
}
