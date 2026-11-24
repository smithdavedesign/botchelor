/**
 * The show's icon as code (docs/brand.md, "The app icon"): a pink heart in a purple satin blindfold, smiling, on the
 * night stage. David's pick on 2026-11-23, replacing the white heart on a pink-to-purple tile, which said "dating app"
 * and nothing about the show. The smile is what makes it a blindfold: with no face under it, a band with a knot and
 * tails reads as a headband.
 *
 * Drawn on a 512 grid. scripts/make-icons.mjs turns it into every file (the tab icon, the app icons, the press kit's
 * logo, the social avatars), so change the art here and re-run that, never a PNG by hand.
 */

export const HEART =
  "M256 404C232 386 118 312 110 222C104 156 150 116 200 116C228 116 246 132 256 152C266 132 284 116 312 116C362 116 408 156 402 222C394 312 280 386 256 404Z";
/** The night ink: the smile. */
export const NIGHT = "#1c0f24";

/** Gradients and the glow, with an id prefix so two icons on one page never share an id. */
const defs = (p) =>
  `<radialGradient id="${p}bg" cx="50%" cy="40%" r="78%"><stop offset="0" stop-color="#3b1641"/><stop offset=".55" stop-color="#1e0f27"/><stop offset="1" stop-color="#110a17"/></radialGradient>` +
  `<linearGradient id="${p}hf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff86a8"/><stop offset=".55" stop-color="#f2417b"/><stop offset="1" stop-color="#c32f78"/></linearGradient>` +
  `<filter id="${p}gl" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="24"/></filter>` +
  `<linearGradient id="${p}band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a62e8"/><stop offset=".5" stop-color="#7a36c9"/><stop offset="1" stop-color="#55238f"/></linearGradient>` +
  `<linearGradient id="${p}tail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c2fb4"/><stop offset="1" stop-color="#4a1f7e"/></linearGradient>`;

/** The heart in its blindfold: glow, heart, the knot's tails, the band with its hems, the knot, the smile. */
export function figure(p, { tails = true, knot = true, smileWidth = 15 } = {}) {
  return (
    `<path d="${HEART}" fill="#ff4f86" opacity=".35" filter="url(#${p}gl)"/>` +
    `<path d="${HEART}" fill="url(#${p}hf)"/>` +
    (tails
      ? `<path d="M444 238C462 262 468 292 486 316L460 328C448 300 434 274 424 252Z" fill="url(#${p}tail)"/>` +
        `<path d="M430 246C436 278 428 306 434 340L408 340C404 308 410 280 410 252Z" fill="url(#${p}tail)"/>`
      : "") +
    `<path d="M78 188Q256 220 432 188L436 256Q256 288 74 256Z" fill="url(#${p}band)"/>` +
    `<path d="M78 188Q256 220 432 188" stroke="#d2b6ff" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M74 256Q256 288 436 256" stroke="#3d1868" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    (knot
      ? `<path d="M416 200C446 190 468 210 458 236C450 258 422 256 412 240Z" fill="url(#${p}band)"/>` +
        `<path d="M420 206C440 200 452 212 448 228" stroke="#d2b6ff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`
      : "") +
    `<path d="M226 304Q256 332 286 304" stroke="${NIGHT}" stroke-width="${smileWidth}" fill="none" stroke-linecap="round"/>`
  );
}

/**
 * One whole icon as SVG. `scale` shrinks the figure about the middle (the maskable safe zone, round avatars); `radius`
 * rounds the tile as a share of its width (0 = full bleed); `view` crops (the tab icon's tighter frame).
 */
export function icon({ p = "bz-", size = 512, scale = 1, radius = 0, view = "0 0 512 512", ...art } = {}) {
  const [vx, vy, vw] = view.split(" ").map(Number);
  const clip = radius ? `<clipPath id="${p}clip"><rect x="${vx}" y="${vy}" width="${vw}" height="${vw}" rx="${radius * vw}"/></clipPath>` : "";
  const inner =
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vw}" fill="url(#${p}bg)"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${figure(p, art)}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${view}" role="img" aria-label="Botchelor">` +
    `<defs>${defs(p)}${clip}</defs>${radius ? `<g clip-path="url(#${p}clip)">${inner}</g>` : inner}</svg>`
  );
}

/** The browser tab's icon: a tighter crop with no tails or knot and a bolder smile, so the heart, the band and a face
 * still read at 16px. */
export const tabIcon = (size = 32) => icon({ p: "t-", size, radius: 0.22, view: "70 100 380 380", tails: false, knot: false, smileWidth: 26 });

/** Android's notification badge: white on transparent (Android draws it from the shape alone), the band cut from the
 * heart by thin gaps so it still reads as a blindfold. */
export function badge(size = 96) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="40 60 452 420">` +
    `<defs><mask id="b-m"><rect width="512" height="512" fill="#fff"/><path d="M74 176Q256 208 440 176L446 270Q256 302 66 270Z" fill="#000"/></mask></defs>` +
    `<path d="${HEART}" fill="#fff" mask="url(#b-m)"/>` +
    `<path d="M84 194Q256 226 426 194L430 252Q256 284 80 252Z" fill="#fff"/>` +
    `<path d="M444 238C462 262 468 292 486 316L460 328C448 300 434 274 424 252Z" fill="#fff"/>` +
    `<path d="M430 246C436 278 428 306 434 340L408 340C404 308 410 280 410 252Z" fill="#fff"/>` +
    `<path d="M416 200C446 190 468 210 458 236C450 258 422 256 412 240Z" fill="#fff"/></svg>`
  );
}
