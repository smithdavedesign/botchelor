import { frontierConfigured } from "@/lib/model";
import FrontierCompare from "./FrontierCompare";

export const dynamic = "force-dynamic";

/** Admin: a password-gated tool to try a frontier (paid) model on a handful of examples. */
export default function AdminPage() {
  return (
    <article>
      <p className="kicker">Admin · frontier model</p>
      <h1>Compare a frontier model</h1>
      <p className="muted">
        Gated by a password, so the frontier (paid) model only runs on your approval — a handful of examples at a time.
        The live show keeps using the free model, so marginal cost stays $0. Nothing here writes an episode.
      </p>
      <FrontierCompare configured={frontierConfigured()} />
    </article>
  );
}
