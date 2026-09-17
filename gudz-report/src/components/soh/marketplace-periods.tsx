import type { SnapshotMarketplace } from "@/lib/report/snapshot-model";

/**
 * Each marketplace's own reporting window, on one line.
 *
 * It exists because the windows genuinely differ inside a single workbook —
 * Blinkit runs to August and Bigbasket to September — so the header's single
 * period would otherwise be a lie by omission. A table per marketplace said the
 * same thing with forty times the furniture.
 */

function short(day: string | null): string {
  if (!day) return "—";
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      });
}

export function MarketplacePeriods({
  sections,
}: {
  sections: SnapshotMarketplace[];
}) {
  const usable = sections.filter((section) => section.status === "completed");
  if (usable.length <= 1) return null;

  const failed = sections.filter((section) => section.status === "failed");

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-200 bg-white px-5 py-2 text-[11px] text-zinc-500">
      {usable.map((section) => (
        <span key={section.marketplace}>
          <span className="text-zinc-700 capitalize">{section.marketplace}</span>{" "}
          {section.periodStart && section.periodEnd
            ? `${short(section.periodStart)} – ${short(section.periodEnd)}`
            : "no dates"}
        </span>
      ))}
      {failed.map((section) => (
        <span key={section.marketplace} className="text-red-600" title={section.errorMessage ?? undefined}>
          <span className="capitalize">{section.marketplace}</span> not processed
        </span>
      ))}
    </p>
  );
}
