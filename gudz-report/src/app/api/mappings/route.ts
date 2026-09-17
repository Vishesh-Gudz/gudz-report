import { anyApi } from "convex/server";
import { z } from "zod";

import { getConvexClient } from "@/lib/convex/server";

/**
 * Confirming and withdrawing product mappings.
 *
 * A confirmation changes every number on the report for that product, so the
 * input is parsed rather than trusted: a mapping with no identifier would match
 * nothing, and one with no ERP item would silently resolve a product to
 * undefined. Both are refused here with a reason, not at the database.
 *
 * Withdrawal is a first-class operation, not an afterthought. A confirmed
 * mapping outranks every inferred route, which means a wrong one produces a
 * confidently wrong report with nothing on screen to question — so taking one
 * back has to be as easy as making it.
 */

const confirmSchema = z
  .object({
    marketplace: z.string().min(1, "A marketplace is required."),
    ean: z.string().nullable().optional(),
    marketplaceItemId: z.string().nullable().optional(),
    erpItemId: z.string().min(1, "An ERP item is required."),
    erpSku: z.string().min(1),
    erpName: z.string().min(1),
    note: z.string().nullable().optional(),
    confirmedBy: z.string().nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.ean?.trim()) || Boolean(value.marketplaceItemId?.trim()),
    {
      message:
        "A mapping needs an EAN or a marketplace item id — otherwise there is nothing to match a row on.",
      path: ["ean"],
    },
  );

function noConvex(): Response {
  return Response.json(
    {
      ok: false,
      error:
        "Convex is not configured, so mappings cannot be saved. Run `npx convex dev` and reload.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const client = getConvexClient();
  if (!client) return noConvex();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid mapping.",
        problems: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  try {
    const id = await client.mutation(anyApi.productMappings.confirm as never, {
      ...parsed.data,
    } as never);
    return Response.json({ ok: true, id });
  } catch (cause) {
    return Response.json(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : "Could not save the mapping.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const client = getConvexClient();
  if (!client) return noConvex();

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ ok: false, error: "No mapping id given." }, { status: 400 });
  }

  try {
    await client.mutation(anyApi.productMappings.remove as never, { id } as never);
    return Response.json({ ok: true });
  } catch (cause) {
    return Response.json(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : "Could not remove the mapping.",
      },
      { status: 500 },
    );
  }
}
