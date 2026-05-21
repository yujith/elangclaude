import type { Metadata } from "next";
import Link from "next/link";
import { withOrg } from "@elc/db";
import { requireRole } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Org admin · Activity",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function metadataPreview(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}

export default async function OrgAdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const ctx = await requireRole("OrgAdmin");
  const db = withOrg(ctx);
  const sp = await searchParams;

  const cursorTimestamp = sp.cursor ? new Date(sp.cursor) : null;
  const cursorValid =
    cursorTimestamp !== null && !Number.isNaN(cursorTimestamp.getTime());

  // SuperAdmin content.* events live under SYSTEM_ORG_ID, so withOrg(ctx)
  // already excludes them — no special filter needed here.
  const rows = await db.activityLog.findMany({
    where: cursorValid ? { timestamp: { lt: cursorTimestamp! } } : undefined,
    orderBy: { timestamp: "desc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      action: true,
      timestamp: true,
      metadata: true,
      user: { select: { name: true, email: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1].timestamp.toISOString() : null;

  return (
    <section className="px-6 py-12 md:py-16">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Org admin
          </p>
          <h1 className="mt-2 font-display italic font-bold text-4xl md:text-5xl text-brand-black leading-tight">
            Activity.
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700 max-w-2xl">
            A timeline of everything that has happened in your organisation,
            newest first.
          </p>
        </header>

        <div className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 overflow-hidden">
          {page.length === 0 ? (
            <p className="px-6 py-8 font-body text-base text-brand-grey-700">
              Nothing to show. Invite learners or wait for them to take a
              test, and events will land here.
            </p>
          ) : (
            <ul className="divide-y divide-brand-grey-200">
              {page.map((row) => {
                const meta = metadataPreview(row.metadata);
                return (
                  <li key={row.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-heading font-bold text-sm text-brand-black truncate">
                        {row.action}
                      </p>
                      <time
                        dateTime={row.timestamp.toISOString()}
                        className="font-body text-xs text-brand-grey-500 whitespace-nowrap"
                      >
                        {row.timestamp.toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-1 font-body text-xs text-brand-grey-700 truncate">
                      {row.user?.name ?? row.user?.email ?? "—"}
                      {meta ? ` · ${meta}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {nextCursor ? (
          <div className="flex justify-center">
            <Link
              href={`/admin/activity?cursor=${encodeURIComponent(nextCursor)}`}
              className="inline-flex items-center rounded-pill border border-brand-grey-200 px-5 py-2 font-heading font-bold text-brand-black bg-brand-white hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 transition-colors"
            >
              Older →
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
