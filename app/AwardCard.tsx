import Link from "next/link";
import Avatar from "@/app/Avatar";
import CountUp from "@/app/motion/CountUp";
import Tilt from "@/app/motion/Tilt";
import OriginBadge from "@/app/OriginBadge";
import { isAgentMade } from "@/lib/origin";
import type { ReunionAward, ReunionChar } from "@/lib/reunion";

/** The agent badge (app/OriginBadge.tsx) when any of these characters was made over MCP; nothing for people's or the cast. */
export function AgentMark({ chars }: { chars: ReunionChar[] }) {
  const agent = chars.find((c) => isAgentMade(c.origin));
  return agent?.origin ? <OriginBadge origin={agent.origin} /> : null;
}

/** A line that opens on its figure ("9 second dates out of 9.", "10 viewers called them…"): the figure and the rest. */
export function leadingFigure(line: string): { n: number; rest: string } | null {
  const m = /^(\d{1,6})(\D[\s\S]*)$/.exec(line);
  return m ? { n: Number(m[1]), rest: m[2] } : null;
}

/**
 * One award as a title card (pass 2 of the 2026-11-20 visual pop audit): the night surface, the winner's face large,
 * one gold sheen the first time it scrolls into view, the figure that won it counting up, and a lean toward the
 * mouse. The page decides the words (`line`): /reunion swaps in the counted words only when the empty-room rule
 * allows (lib/crowd-threshold.ts), so this card never decides a count's fate. Used by /reunion and the season pages.
 */
export default function AwardCard({ award, line, linked = true }: { award: ReunionAward; line: string; linked?: boolean }) {
  const pair = award.chars.length > 1;
  const size = pair ? 64 : 76;
  const figure = leadingFigure(line);
  return (
    <Tilt className="card award award-card sheen-once" max={5}>
      <h3>{award.title}</h3>
      <div className={pair ? "award-faces is-pair" : "award-faces"}>
        {award.chars.map((c) => {
          const face = <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={size} decorative={!linked} />;
          return linked ? (
            <Link key={c.id} href={`/characters/${c.id}`} className="reunion-face">
              {face}
            </Link>
          ) : (
            <span key={c.id} className="reunion-face">
              {face}
            </span>
          );
        })}
      </div>
      <p className="award-name">
        {award.name} <AgentMark chars={award.chars} />
      </p>
      <p className="award-line">
        {figure ? (
          <>
            <CountUp value={figure.n} />
            {figure.rest}
          </>
        ) : (
          line
        )}
      </p>
    </Tilt>
  );
}
