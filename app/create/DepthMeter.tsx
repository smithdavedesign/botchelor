import { SHEET_WORDS_MAX, SHEET_WORDS_MIN, sheetBand, sheetMeterNote } from "@/lib/sheet-words";

/** The track runs to this many words; past it the fill stays full. */
const TRACK_MAX = 1200;

const at = (words: number) => (Math.min(Math.max(words, 0), TRACK_MAX) / TRACK_MAX) * 100;

/**
 * The sheet's length as a soft meter (lib/sheet-words.ts, PRD styles-and-storylines phase 6): how many words, with the
 * 400–999-word sweet spot marked on the track. Shown on Go deeper and the review. It never stops anyone saving.
 */
export default function DepthMeter({ words }: { words: number }) {
  return (
    <div className="depth-meter" data-band={sheetBand(words)}>
      <span
        className="meter-track"
        role="meter"
        aria-label="How long their sheet is"
        aria-valuemin={0}
        aria-valuemax={TRACK_MAX}
        aria-valuenow={Math.min(words, TRACK_MAX)}
        aria-valuetext={`${words} words`}
      >
        <span className="meter-fill" style={{ width: `${at(words)}%` }} />
        <span className="depth-meter-sweet" style={{ left: `${at(SHEET_WORDS_MIN)}%`, width: `${at(SHEET_WORDS_MAX) - at(SHEET_WORDS_MIN)}%` }} aria-hidden />
      </span>
      <p className="muted small">{sheetMeterNote(words)}</p>
    </div>
  );
}
