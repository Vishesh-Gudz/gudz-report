import Link from "next/link";
import { anyApi } from "convex/server";

import {
  MappingResolver,
  type ConfirmedMappingDoc,
} from "@/components/mappings/mapping-resolver";
import type { UnresolvedProduct } from "@/components/mappings/mapping-resolver";
import { getConvexClient } from "@/lib/convex/server";
import { listSnapshots, loadSnapshot } from "@/lib/report/snapshot-view";

export const metadata = { title: "Product mappings · Healthy Master" };

/**
 * The internal screen where a person closes the gap the report cannot.
 *
 * The products needing a decision come from the saved report rather than a
 * separate list, so the two cannot drift apart. They survive the raw upload
 * being deleted, because a snapshot row remembers that its product never
 * reached an ERP item.
 *
 * A Server Component, so the ERP key stays in this process — the catalogue
 * search the picker uses goes through `/api/catalog` for the same reason.
 */
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedMarketplace = single(params.marketplace) ?? null;

  const snapshots = await listSnapshots(5);
  const latest = snapshots.find((entry) => entry.status === "completed") ?? null;
  const snapshot = latest ? await loadSnapshot(latest.id) : null;

  // Unresolved products, grouped across months — the same product in June and
  // July is one decision, not three.
  const byMarketplace = new Map<string, Map<string, UnresolvedProduct>>();
  for (const row of snapshot?.rows ?? []) {
    if (row.mappingStatus !== "unresolved") continue;
    const bucket = byMarketplace.get(row.marketplace) ?? new Map<string, UnresolvedProduct>();
    const existing = bucket.get(row.sku);
    bucket.set(row.sku, {
      sourceRow: 0,
      orderDate: null,
      productName: row.productName,
      marketplaceItemId: row.marketplaceItemId,
      ean: row.ean,
      sku: row.sku,
      quantity: (existing?.quantity ?? 0) + row.salesQuantity,
      amount: (existing?.amount ?? 0) + row.salesValue,
      rowCount: (existing?.rowCount ?? 0) + row.sourceRows,
      status: "unmapped",
      reason: row.mappingReason,
      candidates: [],
    });
    byMarketplace.set(row.marketplace, bucket);
  }

  const marketplaces = [...byMarketplace.keys()].sort();
  const marketplace =
    (requestedMarketplace && byMarketplace.has(requestedMarketplace)
      ? requestedMarketplace
      : null) ??
    [...marketplaces].sort(
      (a, b) => (byMarketplace.get(b)?.size ?? 0) - (byMarketplace.get(a)?.size ?? 0),
    )[0] ??
    null;

  const rows = marketplace
    ? [...(byMarketplace.get(marketplace)?.values() ?? [])].sort(
        (a, b) => (b.quantity ?? 0) - (a.quantity ?? 0),
      )
    : [];

  let confirmed: ConfirmedMappingDoc[] = [];
  let confirmedError: string | null = null;
  const client = getConvexClient();
  if (client && marketplace) {
    try {
      confirmed = (await client.query(
        anyApi.productMappings.listForMarketplace as never,
        { marketplace } as never,
      )) as ConfirmedMappingDoc[];
    } catch {
      confirmedError = "Saved mappings could not be read. Try reloading.";
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">Healthy Master</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-zinc-900">
            Product mappings
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-600">
            A marketplace names its products its own way. This ties a marketplace
            product to an ERP item for the cases the report cannot decide alone —
            a shared barcode, or no usable identifier. Confirmations are reused,
            so a product is resolved once rather than every month.
          </p>
        </div>
        <Link
          href={latest ? `/?report=${latest.id}` : "/"}
          className="text-[13px] underline underline-offset-4"
        >
          Back to the report
        </Link>
      </header>

      {confirmedError ? (
        <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {confirmedError}
        </p>
      ) : null}

      {marketplace === null ? (
        <p className="border border-zinc-200 bg-white px-4 py-3 text-[13px] text-zinc-600">
          Nothing needs a decision. Every product in the latest report reached an
          ERP item.
        </p>
      ) : (
        <>
          {marketplaces.length > 1 ? (
            <nav className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <span className="text-zinc-500">Marketplace:</span>
              {marketplaces.map((name) => (
                <Link
                  key={name}
                  href={`/mappings?marketplace=${name}`}
                  className={`rounded border px-2 py-1 capitalize ${
                    name === marketplace
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  {name}
                  <span className="ml-1.5 opacity-70">
                    {byMarketplace.get(name)?.size ?? 0}
                  </span>
                </Link>
              ))}
            </nav>
          ) : null}

          <MappingResolver marketplace={marketplace} rows={rows} confirmed={confirmed} />
        </>
      )}
    </main>
  );
}
