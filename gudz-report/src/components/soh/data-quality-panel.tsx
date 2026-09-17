import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Minus, XCircle } from "lucide-react";

import type { DataQualityNote } from "@/lib/report/snapshot-model";

/**
 * What the report knows and does not, decided when the snapshot was built.
 *
 * These notes are stored with the snapshot rather than recomputed on open, so a
 * report reopened next month explains itself with the facts that were true when
 * it was made — the same reason its numbers do not move.
 */

const ICONS = { ok: Check, warn: AlertTriangle, absent: Minus, bad: XCircle } as const;
const TONES = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  absent: "text-zinc-400",
  bad: "text-red-600",
} as const;

export function DataQualityPanel({
  notes,
  reviewHref,
  needsReview,
}: {
  notes: DataQualityNote[];
  reviewHref: string;
  needsReview: number;
}) {
  if (notes.length === 0) return null;

  return (
    <section className="border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-zinc-900">Data quality</h2>
      </header>
      <ul>
        {notes.map((note) => {
          const Icon = ICONS[note.state];
          const showReview = needsReview > 0 && note.title.includes("matched to an ERP");
          return (
            <li
              key={note.title}
              className="flex gap-3 border-b border-zinc-100 px-5 py-3 last:border-0"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONES[note.state]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-zinc-900">{note.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{note.detail}</p>
              </div>
              {showReview ? (
                <Link
                  href={reviewHref}
                  className="inline-flex shrink-0 items-center gap-1 self-center rounded border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50"
                >
                  Review
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
