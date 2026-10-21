import { permanentRedirect } from "next/navigation";

/** "The cast" merged into the Characters hub (David, 2026-10-21): its cast tab has the leaderboard, matchmaking and graph. */
export default function CastPage() {
  permanentRedirect("/characters?tab=cast");
}
