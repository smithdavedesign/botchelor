import type { Metadata } from "next";
import Link from "next/link";
import { signedInAdmin } from "../signed-in-admin";
import AdminGate from "../AdminGate";
import Compare from "./Compare";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live face renderers · Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: the live-face renderer compare (lib/live-face/compare.ts): one line, every renderer, side by side, rated. */
export default async function AdminLiveFacePage() {
  const admin = await signedInAdmin();
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Live face
      </p>
      <h1>Live face renderers</h1>
      <p className="muted">
        A character's line, voiced once in their own voice, rendered by every renderer that has a key: the show's own MuseTalk beside the hosted models. Rate each clip 1–5; the averages keep. The
        hosted ones are batch (20 s to minutes a clause) and show the ceiling; only MuseTalk and Simli can carry a call. Keys: your own Connection for a provider when you have one (/account/keys),
        else the house key.
      </p>
      <AdminGate admin={admin} areas={[{ href: "/admin/live-face", label: "Live face" }]}>
        <Compare />
      </AdminGate>
    </article>
  );
}
