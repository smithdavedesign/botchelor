/**
 * An export's files in one zip (lib/media-tools/export.ts). Pictures and videos are compressed already, so they're
 * stored as they are (no second compression to wait for); text is deflated. fflate: pure JS, no native parts.
 */
import { zipSync, type Zippable } from "fflate";

export type ZipEntry = { name: string; bytes: Buffer };

export function zipFiles(entries: readonly ZipEntry[], now: Date = new Date()): Buffer {
  const files: Zippable = {};
  for (const e of entries) files[e.name] = [new Uint8Array(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength), { level: /\.(txt|json|csv)$/i.test(e.name) ? 6 : 0, mtime: now }];
  return Buffer.from(zipSync(files));
}
