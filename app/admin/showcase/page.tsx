import type { Metadata } from "next";
import Link from "next/link";
import { signedInAdmin } from "../signed-in-admin";
import AdminGate from "../AdminGate";
import ShowcaseModeration from "./Panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Showcase · Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: the showcase's moderation (lib/showcase-moderation.ts): what reports held, and what's reported but still up. */
export default async function AdminShowcasePage() {
  const admin = await signedInAdmin();
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Showcase
      </p>
      <h1>Showcase moderation</h1>
      <AdminGate admin={admin} areas={[{ href: "/admin/showcase", label: "Showcase" }]}>
        <ShowcaseModeration />
      </AdminGate>
    </article>
  );
}
