**First-use PIN setup**

Open the hosted app. On your first visit, choose a four-digit PIN and confirm it. The app saves a salted hash and signs you in. Future visits ask for that PIN; trusted browsers stay signed in for seven days. No environment variable or manual database migration is needed for app access: the app creates its access tables automatically.

Only the first successful setup can create the deployment PIN, even when requests arrive simultaneously. This single-pilot testing flow lets the first visitor claim access, so complete setup when first opening the deployed app. Five login submissions are allowed per 15-minute window across the deployment. Existing sessions keep working during a lockout. HTTPS is required for session cookies. Database failures keep the app locked and allow retry.

Local development on your Mac remains login-free. Existing `APP_ACCESS_PIN` or `APP_ACCESS_PASSWORD` settings are honored for deployments that already configured them. If neither is set, first-use setup appears automatically. Changing an environment PIN invalidates existing sessions.

The app-access PIN is separate from the profile sync PIN. The earlier profile sync hash migration is unrelated to first-use access setup. Cached offline data stays on previously authorized devices; use a trusted browser.
