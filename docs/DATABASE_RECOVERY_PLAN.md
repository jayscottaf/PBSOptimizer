# Database Recovery Plan

Use this plan only if the hosted database is lost or replaced. The current app
can run against a fresh Neon database because the schema and upload flows are
already in the repo.

## Current Local Path

This workspace is at:

```text
F:\AI Projects\PBSOptimizer
```

The local environment file is:

```text
F:\AI Projects\PBSOptimizer\.env
```

Do not commit `.env`.

## What Is Already In Place

- `shared/schema.ts` defines the database tables.
- `drizzle.config.ts` reads `DATABASE_URL`.
- `server/db.ts` uses `@neondatabase/serverless`.
- `npm run db:push` applies the Drizzle schema to Postgres.
- Bid package upload and Reasons Report upload routes already exist.

## Recovery Steps

1. Create a Neon project.
2. Copy the pooled Neon connection string.
3. Put it in `.env` as `DATABASE_URL`.
4. Keep the existing OpenAI values in `.env`, or regenerate them if needed.
5. Run:

```powershell
npm install
npm run db:push
```

6. Start the app:

```powershell
npm run dev
```

7. Smoke-test the app:

- Save the user profile.
- Upload one bid package PDF.
- Confirm the package reaches `completed`.
- Confirm pairings render on the dashboard.
- Upload one Reasons Report HTML if available.
- Confirm the Data Management Panel shows the expected package/report counts.

## Verification

The health endpoint should report a connected database:

```text
http://127.0.0.1:5000/api/health
```

The most important signal after a bid package upload is that the package status
changes from `processing` to `completed`. The dashboard pairings query depends
on that completed status.

## Watch Items

- Use Neon's pooled connection string, not the direct connection string.
- `npm run db:push` is fine for a fresh database.
- Reasons Report history must be rebuilt by re-uploading NAVBLUE HTML reports.
- The app is effectively single-tenant because `bidPackages` is not scoped by
  `userId`.
- If package parsing gets stuck, inspect `server/pdfParser.ts` and server logs.
- If Reasons Reports fail, inspect `server/reasonsReportParser.ts`.

