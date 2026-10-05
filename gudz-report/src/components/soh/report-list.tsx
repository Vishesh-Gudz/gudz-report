"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Trash2 } from "lucide-react";

import { getBrowserConvexClient } from "@/lib/convex/browser";
import type { SnapshotListing } from "@/lib/report/snapshot-view";

/**
 * Recent reports, and the one thing you can do to a saved one: discard it.
 *
 * The list is rendered on the client purely so a deleted report leaves the
 * screen the moment Convex confirms, rather than at the end of the next server
 * render. The rows themselves are the server's — they arrive as props already
 * read and filtered, and nothing here recomputes a figure.
 *
 * Delete is kept quiet on purpose: an icon at the end of the row, after Open,
 * which is the action anybody actually came for. It asks first, because a
 * snapshot is the permanent record of a month and the workbook that produced it
 * is long gone — there is nothing to re-import from.
 */

function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function describe(snapshot: SnapshotListing): string {
  if (snapshot.marketplaces.length === 0) return "No marketplace";
  if (snapshot.marketplaces.length === 1) return snapshot.marketplaces[0]!;
  return `All marketplaces`;
}

function period(snapshot: SnapshotListing): string {
  if (snapshot.periodStart && snapshot.periodEnd) {
    return `${shortDay(snapshot.periodStart)} – ${shortDay(snapshot.periodEnd)}`;
  }
  return snapshot.periodsDiffer ? "Multiple periods" : "No period";
}

type Status = { readonly tone: "ok" | "bad"; readonly text: string } | null;

export function ReportList({
  snapshots,
  initialStatus = null,
}: {
  snapshots: ReadonlyArray<SnapshotListing>;
  /** Set when the user arrived here because the report they had open was deleted. */
  initialStatus?: Status;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<SnapshotListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<Status>(initialStatus);

  const close = useCallback(() => {
    if (!busy) setConfirming(null);
  }, [busy]);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, close]);

  async function remove(snapshot: SnapshotListing) {
    setBusy(true);
    setStatus(null);
    try {
      const convex = getBrowserConvexClient();
      if (!convex) throw new Error("Convex is not configured for this deployment.");

      await convex.mutation("snapshots:remove" as never, {
        snapshotId: snapshot.id,
      } as never);

      // Drop it here first. The server list is re-read straight after, but the
      // row should go when the delete lands, not when the render returns.
      setRemoved((previous) => new Set(previous).add(snapshot.id));
      setStatus({ tone: "ok", text: "Report deleted" });
      setConfirming(null);
      router.refresh();
    } catch (cause) {
      // The reason belongs in the console, not on screen: it names Convex
      // tables and deployment state, which tells a reader nothing they can act
      // on and leaks the shape of the backend.
      console.error("Failed to delete report snapshot", snapshot.id, cause);
      setStatus({ tone: "bad", text: "Unable to delete report" });
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  const visible = snapshots.filter((snapshot) => !removed.has(snapshot.id));

  return (
    <>
      {status ? (
        <p
          aria-live="polite"
          className={`text-[12px] ${status.tone === "ok" ? "text-zinc-500" : "text-red-600"}`}
        >
          {status.text}
        </p>
      ) : null}

      <ul className="border border-zinc-200 bg-white">
        {visible.map((snapshot) => (
          <li
            key={snapshot.id}
            className="flex items-center gap-4 border-b border-zinc-100 px-4 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-900 capitalize">
                {describe(snapshot)}
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">{period(snapshot)}</p>
            </div>
            <span className="shrink-0 text-[12px] text-zinc-400">
              {new Date(snapshot.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <Link
              href={`/?report=${snapshot.id}`}
              className="shrink-0 rounded border border-zinc-200 px-3 py-1 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open
            </Link>
            <button
              type="button"
              onClick={() => setConfirming(snapshot)}
              aria-label={`Delete ${describe(snapshot)} report`}
              title="Delete report"
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 px-6"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-report-heading"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[20rem] rounded border border-zinc-200 bg-white p-4 shadow-lg"
          >
            <h2
              id="delete-report-heading"
              className="text-[14px] font-semibold text-zinc-900"
            >
              Delete report?
            </h2>

            <p className="mt-2.5 text-[13px] font-medium text-zinc-900 capitalize">
              {describe(confirming)}
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-500">{period(confirming)}</p>

            <p className="mt-3 text-[12px] text-zinc-500">
              This report snapshot will be removed.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={close}
                disabled={busy}
                className="rounded border border-zinc-200 px-3 py-1 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove(confirming)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
