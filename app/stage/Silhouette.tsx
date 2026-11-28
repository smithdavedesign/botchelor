import { avatarPalette, initials } from "@/lib/avatar";

/**
 * A character with no picture yet, standing on the date theater's stage (2026-11-28, Dave: "fill the portrait gap"):
 * a figure in their own colours, lit from behind like someone the camera hasn't found yet, their initials on a lapel
 * pin. Sized like a stage picture (three-quarter length), so it stands where a cutout would. Decorative: the scene names
 * the character in words.
 */
export default function Silhouette({ id, name, hue, className = "" }: { id: string; name: string; hue: number | null; className?: string }) {
  const p = avatarPalette(id, hue);
  const g = `sil-${id.replace(/[^\w-]/g, "")}`;
  return (
    <div className={`character-figure stage-silhouette ${className}`.trim()} data-figure="silhouette" aria-hidden="true">
      <svg viewBox="0 0 240 400" preserveAspectRatio="xMidYMax meet" className="stage-silhouette-svg">
        <defs>
          <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor={p.from} />
            <stop offset="1" stopColor={p.to} />
          </linearGradient>
          <radialGradient id={`${g}-rim`} cx="0.5" cy="0.3" r="0.7">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
          <linearGradient id={`${g}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.8" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${g}-mask`}>
            <rect width="240" height="400" fill={`url(#${g}-fade)`} />
          </mask>
        </defs>
        <g mask={`url(#${g}-mask)`}>
          {/* Head, neck, shoulders, arms at the sides, to the hips. */}
          <path
            d="M120 18c25 0 43 20 43 47 0 19-8 35-21 44v14c0 6 4 10 10 12l36 13c19 7 30 23 32 44l8 84c1 12-6 22-17 24l-6 1c-9 2-17-4-19-13l-9-62v176H63V222l-9 62c-2 9-10 15-19 13l-6-1c-11-2-18-12-17-24l8-84c2-21 13-37 32-44l36-13c6-2 10-6 10-12v-14c-13-9-21-25-21-44 0-27 18-47 43-47Z"
            fill={`url(#${g}-body)`}
            fillOpacity="0.78"
            stroke={p.soft}
            strokeOpacity="0.7"
            strokeWidth="2.5"
          />
          <path
            d="M120 18c25 0 43 20 43 47 0 19-8 35-21 44v14c0 6 4 10 10 12l36 13c19 7 30 23 32 44l8 84c1 12-6 22-17 24l-6 1c-9 2-17-4-19-13l-9-62v176H63V222l-9 62c-2 9-10 15-19 13l-6-1c-11-2-18-12-17-24l8-84c2-21 13-37 32-44l36-13c6-2 10-6 10-12v-14c-13-9-21-25-21-44 0-27 18-47 43-47Z"
            fill={`url(#${g}-rim)`}
          />
          <circle cx="146" cy="178" r="15" fill={p.soft} opacity="0.92" />
          <text x="146" y="183" textAnchor="middle" fontSize="13" fontWeight="800" fill={p.to}>
            {initials(name)}
          </text>
        </g>
      </svg>
    </div>
  );
}
