import Link from "next/link";

import type { DataQualityNote } from "@/lib/report/snapshot-model";

/**
 * What the report knows and does not, in one line.
 *
 * Deliberately not a warning panel. These are standing facts about the data —
 * how much is mapped, whether GRN exists — and a reader checks them the way they
 * check a footnote, not the way they read an alert. A banner would be dismissed
 * once and ignored thereafter.
 *
 * The notes are stored with the snapshot rather than recomputed, so a report
 * reopened next month explains itself with the facts that were true when it was
 * made — the same reason its numbers do not move. The full sentence is on hover.
 */

const num = new Intl.NumberFormat("en-IN");

const DOT = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  absent: "bg-zinc-300",
  bad: "bg-red-500",
} as const;

export function DataQualityPanel({
  notes,
  mapped,
  total,
  needsReview,
  reviewHref,
}: {
  notes: DataQualityNote[];
  mapped: number;
  total: number;
  needsReview: number;
  reviewHref: string;
}) {
  // Titles are already short; the detail is the long-form explanation and stays
  // on hover so the line reads as a status rather than a paragraph.
  const rest = notes.filter(
    (note) => !note.title.includes("matched to an ERP product"),
  );

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-zinc-200 bg-white px-5 py-3 text-[12px]">
      <span className="text-[11px] tracking-wide text-zinc-500 uppercase">
        Data quality
      </span>

      {total > 0 ? (
        <span className="flex items-center gap-1.5 text-zinc-700">
          <span
            className={`h-1.5 w-1.5 rounded-full ${needsReview > 0 ? DOT.warn : DOT.ok}`}
            aria-hidden
          />
          {num.format(mapped)} / {num.format(total)} mapped
        </span>
      ) : null}

      {needsReview > 0 ? (
        <Link
          href={reviewHref}
          className="flex items-center gap-1.5 text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900"
        >
          {num.format(needsReview)} need review
        </Link>
      ) : null}

      {rest.map((note) => (
        <span
          key={note.title}
          title={note.detail}
          className="flex items-center gap-1.5 text-zinc-600"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[note.state]}`} aria-hidden />
          {note.title}
        </span>
      ))}
    </section>
  );
}
