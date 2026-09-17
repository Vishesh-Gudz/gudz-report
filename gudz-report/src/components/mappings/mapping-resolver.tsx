"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Trash2, X } from "lucide-react";

/**
 * A marketplace product that reached no ERP item.
 *
 * Declared here rather than imported from the report layer: this screen now
 * reads its list from the saved snapshot, and the shape it needs is its own.
 */
export interface UnresolvedProduct {
  readonly sourceRow: number;
  readonly orderDate: string | null;
  readonly productName: string | null;
  readonly marketplaceItemId: string | null;
  readonly ean: string | null;
  readonly sku: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  readonly rowCount: number;
  readonly status: "ambiguous" | "unmapped";
  readonly reason: string;
  readonly candidates: ReadonlyArray<{ itemId: string; sku: string; name: string }>;
}

/**
 * Resolving products a person has to decide on.
 *
 * Everything the report could work out for itself is already mapped by the time
 * this screen is reached. What is left is genuinely ambiguous: an EAN shared by
 * several catalogue items, or a product with no usable identifier at all where
 * the only lead is a name. Both are cases where guessing would produce a
 * confident wrong number, so the decision is handed to a human — and recorded,
 * so nobody has to make it twice.
 *
 * The screen is ordered by unreconciled quantity, because that is the order in
 * which the decisions matter. Confirming the top product of a marketplace month
 * can move more of the report than the next twenty combined.
 *
 * Suggested candidates are offered but never preselected. A preselected radio
 * button is a decision somebody made by pressing Save, and the whole point of
 * this screen is that the decision be deliberate.
 */

interface CatalogHit {
  itemId: string;
  sku: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  isActive: boolean;
}

export interface ConfirmedMappingDoc {
  _id: string;
  ean: string | null;
  marketplaceItemId: string | null;
  erpItemId: string;
  erpSku: string;
  erpName: string;
  note: string | null;
  confirmedAt: number;
  confirmedBy: string | null;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

export function MappingResolver({
  marketplace,
  rows,
  confirmed,
}: {
  marketplace: string;
  rows: UnresolvedProduct[];
  confirmed: ConfirmedMappingDoc[];
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function withdraw(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/mappings?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "Could not withdraw the mapping.");
      else router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not withdraw the mapping.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Needs a decision ({num.format(rows.length)})
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Ordered by unreconciled quantity. Confirming the product at the top
            moves more of the report than the rest of the list combined.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
            Every product in this report reached an ERP item. Nothing to decide.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const key = `${row.ean ?? ""}|${row.marketplaceItemId ?? ""}`;
              return (
                <li
                  key={key || row.sourceRow}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{row.productName ?? "(no name)"}</p>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        EAN {row.ean ?? "—"} · item id {row.marketplaceItemId ?? "—"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {num.format(row.rowCount)} row
                        {row.rowCount === 1 ? "" : "s"} ·{" "}
                        {row.quantity === null ? "—" : num.format(row.quantity)} units ·{" "}
                        {row.amount === null ? "—" : inr.format(row.amount)} ·{" "}
                        first seen at spreadsheet row {row.sourceRow}
                      </p>
                      <p className="mt-1 max-w-2xl text-xs text-zinc-500">{row.reason}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpenKey(openKey === key ? null : key)}
                      className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {openKey === key ? "Close" : "Resolve"}
                    </button>
                  </div>

                  {openKey === key ? (
                    <ResolveForm
                      marketplace={marketplace}
                      row={row}
                      onSaved={() => {
                        setOpenKey(null);
                        router.refresh();
                      }}
                      onError={setError}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Confirmed ({num.format(confirmed.length)})
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            These outrank every identifier the report could match on its own, so a
            wrong one is a wrong report with nothing on screen to question.
            Withdrawing is immediate.
          </p>
        </div>

        {confirmed.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing confirmed for this marketplace yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">EAN</th>
                  <th className="px-3 py-2 font-medium">Item ID</th>
                  <th className="px-3 py-2 font-medium">ERP SKU</th>
                  <th className="px-3 py-2 font-medium">ERP product</th>
                  <th className="px-3 py-2 font-medium">Confirmed</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {confirmed.map((mapping) => (
                  <tr
                    key={mapping._id}
                    className="border-t border-zinc-200 align-top dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{mapping.ean ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {mapping.marketplaceItemId ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{mapping.erpSku}</td>
                    <td className="max-w-[22rem] px-3 py-2">{mapping.erpName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500">
                      {new Date(mapping.confirmedAt).toISOString().slice(0, 10)}
                      {mapping.confirmedBy ? ` · ${mapping.confirmedBy}` : ""}
                    </td>
                    <td className="max-w-[16rem] px-3 py-2 text-xs text-zinc-500">
                      {mapping.note ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => withdraw(mapping._id)}
                        disabled={busyId === mapping._id}
                        className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
                      >
                        {busyId === mapping._id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3 w-3" aria-hidden />
                        )}
                        Withdraw
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Pick an ERP item for one product: a suggestion, or anything in the catalogue. */
function ResolveForm({
  marketplace,
  row,
  onSaved,
  onError,
}: {
  marketplace: string;
  row: UnresolvedProduct;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<CatalogHit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const [confirmedBy, setConfirmedBy] = useState("");
  const [saving, setSaving] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as {
        ok: boolean;
        items?: CatalogHit[];
        error?: string;
      };
      if (!body.ok) onError(body.error ?? "Could not search the catalogue.");
      else setHits(body.items ?? []);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not search the catalogue.");
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch("/api/mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace,
          ean: row.ean,
          marketplaceItemId: row.marketplaceItemId,
          erpItemId: selected.itemId,
          erpSku: selected.sku,
          erpName: selected.name,
          note: note || null,
          confirmedBy: confirmedBy || null,
        }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!body.ok) onError(body.error ?? "Could not save the mapping.");
      else onSaved();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not save the mapping.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {row.candidates.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            Suggested by name — unconfirmed
          </legend>
          <p className="text-xs text-zinc-500">
            Name similarity only. Nothing is preselected: these are the report&rsquo;s
            guesses, and picking one is your decision, not its.
          </p>
          {row.candidates.map((candidate) => (
            <label
              key={candidate.sku}
              className="flex cursor-pointer items-start gap-2 rounded border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <input
                type="radio"
                name={`candidate-${row.sourceRow}`}
                className="mt-1"
                checked={selected?.sku === candidate.sku}
                onChange={() =>
                  setSelected({
                    itemId: candidate.itemId,
                    sku: candidate.sku,
                    name: candidate.name,
                    barcode: null,
                    brand: null,
                    isActive: true,
                  })
                }
              />
              <span>
                <code className="text-xs">{candidate.sku}</code> — {candidate.name}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">
            Or search the ERP catalogue
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SKU, name or barcode"
            className="w-72 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>
        <button
          type="submit"
          disabled={searching}
          className="inline-flex items-center gap-1 rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          Search
        </button>
      </form>

      {hits.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {hits.map((hit) => (
            <li key={hit.itemId}>
              <button
                type="button"
                onClick={() => setSelected(hit)}
                className={`flex w-full items-start gap-2 rounded border p-2 text-left text-sm ${
                  selected?.itemId === hit.itemId
                    ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-950"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                }`}
              >
                {selected?.itemId === hit.itemId ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0 opacity-0" aria-hidden />
                )}
                <span>
                  <code className="text-xs">{hit.sku}</code> — {hit.name}
                  <span className="block text-xs text-zinc-500">
                    barcode {hit.barcode ?? "—"}
                    {hit.isActive ? "" : " · inactive"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Why (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Same product, 100g pouch"
            className="w-72 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Your name (optional)</span>
          <input
            type="text"
            value={confirmedBy}
            onChange={(event) => setConfirmedBy(event.target.value)}
            className="w-40 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={!selected || saving}
          className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {selected ? `Confirm as ${selected.sku}` : "Pick an ERP item"}
        </button>
      </div>
    </div>
  );
}
