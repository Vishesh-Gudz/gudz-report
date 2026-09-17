# Convex functions

`_generated/` is written by the Convex CLI and **is committed** — without it the
project does not typecheck. The copies checked in here were written by hand so
the foundation compiles before anyone has logged in; the first `npx convex dev`
overwrites them from the real schema, which is the version to trust.

## First run

```bash
npx convex dev
```

This is interactive: it logs in (or creates an anonymous local deployment),
provisions a dev deployment and writes `CONVEX_DEPLOYMENT` plus
`NEXT_PUBLIC_CONVEX_URL` into `.env.local`. Leave it running while developing —
it watches `convex/` and pushes on save.

## Deployment environment

The ERP credential belongs to the Convex deployment, not to the Next process:
`convex/erp.ts` runs server-side in Convex and reads it from there.

```bash
npx convex env set ERP_API_URL https://api.delivery.gudz.in
npx convex env set ERP_API_KEY <key>
```

Set the same pair on production with `--prod`. Never prefix either
`NEXT_PUBLIC_` — that would ship the key to the browser.

Verify without revealing the value:

```bash
npx convex env list
npx convex run erp:healthCheck
```

## Files

| File | |
|---|---|
| `schema.ts` | tables and indexes |
| `imports.ts` | import lifecycle, row persistence |
| `excel.ts` | Node action: parse, normalize, persist a workbook |
| `erp.ts` | Node action: read-only ERP fetches |
| `reconciliation.ts` | match results storage and reads |
