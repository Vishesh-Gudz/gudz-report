import { getErpClient } from "@/lib/erp";
import { getCatalog } from "@/lib/erp/catalog";

/**
 * ERP catalogue search, for the mapping screen's product picker.
 *
 * A proxy rather than shipping the catalogue to the browser: 3,067 items with
 * their identifiers is a payload nobody should download to type four letters
 * into a box, and the ERP key has to stay in this process regardless.
 *
 * The response is deliberately narrow. The picker needs to show a person enough
 * to recognise a product and then send back an id — it has no use for stock
 * figures, tax rates or channel mappings, so none are returned.
 */

/** Short enough that a stray keystroke does not page the whole catalogue. */
const MIN_QUERY = 2;

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (query.length < MIN_QUERY) {
    return Response.json({
      ok: true,
      items: [],
      note: `Type at least ${MIN_QUERY} characters.`,
    });
  }

  try {
    // The ERP's `search` covers SKU, name and barcode, which is exactly the
    // three things somebody would type here.
    const page = await getCatalog(getErpClient(), {
      search: query,
      includeIdentifiers: false,
      limit: 25,
    });

    return Response.json({
      ok: true,
      items: page.items.map((item) => ({
        itemId: item.itemId,
        sku: item.sku,
        name: item.name,
        barcode: item.barcode,
        brand: item.brand,
        isActive: item.isActive,
      })),
      hasMore: page.hasMore,
    });
  } catch (cause) {
    return Response.json(
      {
        ok: false,
        // Never the key, and never the raw upstream body — just what went wrong.
        error: cause instanceof Error ? cause.message : "Could not search the ERP catalogue.",
      },
      { status: 502 },
    );
  }
}
