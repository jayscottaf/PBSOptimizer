**Application access during testing**

Local development on your Mac needs no login. Hosted access uses a four-digit PIN, with no username. Enter it once to remember a trusted browser for seven days. Use HTTPS so the secure session cookie works.

Before deploying:

1. Set `APP_ACCESS_PIN` to your chosen four digits in the hosting environment (leading zeros are supported). Do not commit the PIN. Missing or invalid configuration keeps access closed. Remove `APP_ACCESS_PASSWORD`; it remains supported only for existing deployments that have not switched to PIN access.
2. Set `APP_ORIGIN` to the exact HTTPS origin without a trailing slash.
3. Run `npx tsx scripts/migrate-app-access.ts` against the deployment database. This creates session and attempt-limit tables; it is safe to repeat.
4. For the earlier sync-PIN changes, run `npx tsx scripts/migrate-pin-hashes.ts` together with the new server rollout. The old server cannot verify migrated sync hashes.

These commands have not been applied to the hosted database. PIN access allows five login submissions per 15-minute window across the whole deployment, including all serverless instances. Further attempts receive a retry message; existing sessions continue working. This deliberately small shared budget fits a single-pilot test app. It can temporarily block new logins if someone else exhausts it. Database outages fail closed.

Sessions use random tokens stored as hashes in the database, with HttpOnly, Secure, SameSite cookies. Changing the app PIN invalidates existing sessions. The app-access PIN is separate from the existing profile sync PIN. Cached offline data remains on previously authorized devices, so use a trusted browser. Clearing site cookies ends that browser's online session.

`npm run dev` bypasses login only for a loopback socket and localhost Host header. LAN/tunnel access does not receive this exception. Origin checks still apply.

The legacy remote smoke script supports `SMOKE_ACCESS_PASSWORD` for password deployments. PIN deployments should be checked through the browser login flow.
