**Application access**

This is a single-pilot deployment. All routes, including the initial document, require HTTP Basic authentication outside loopback development. The app provides a Sign in link when hosted static assets are served separately. The browser prompts for username `pilot` and the deployment password before loading the app. Use HTTPS; do not expose this server directly over public HTTP.

Before deploying this change:

1. Configure `APP_ACCESS_PASSWORD` as a randomly generated secret of at least 24 characters in the hosting environment. Store it in a password manager. Missing/short configuration returns HTTP 503; it never enables anonymous access.
2. Set `APP_ORIGIN` to the exact HTTPS origin, without a trailing slash, for example `https://your-app.example`. This lets requests pass origin validation behind an HTTPS reverse proxy.
3. During rollout, run `npx tsx scripts/migrate-pin-hashes.ts` against the deployment database. It widens the PIN column and hashes existing PINs in one transaction. It is safe to repeat. Deploy the new server with this migration: the old server cannot verify the new hashes.

These deployment changes are deliberately not applied to the live hosted service by a local code review. The migration is tested against temporary database tables. New PIN writes use salted scrypt; PINs and hashes are excluded from API profile responses. PIN linking is a convenience after deployment authentication, not an access credential.

`npm run dev` permits unauthenticated requests only from a loopback socket with a localhost Host header. LAN requests do not get this exception. Development remains subject to origin checks. Never expose the development server via a public tunnel.

For a remote smoke check, set `SMOKE_ACCESS_PASSWORD` in the shell environment. The script sends it through the Authorization header; do not put credentials in the URL. HTTP Basic authentication is cached by the browser; close the private browser session to sign out. Cached offline data remains on a previously authorized device, so use a trusted device/browser profile.
