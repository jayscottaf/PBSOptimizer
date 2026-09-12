**Dependency maintenance — September 12, 2026**

The lockfile passes both `npm audit` and `npm audit --omit=dev` with zero reported vulnerabilities. Keep the lockfile committed and use `npm ci` for reproducibility.

The scoped overrides in package.json resolve vulnerable versions pinned by upstream packages: Express's qs; Vercel's path-to-regexp, undici, and ajv; and esbuild under the legacy Drizzle loader and tsx. Remove an override when the parent dependency adopts a patched compatible version. The Vercel Node package is used only for TypeScript imports and belongs in development dependencies. Drizzle-zod remains on its Zod 3 compatible version.

Verification covered type-checking, lint, 13 regressions, bid checks, frontend/server bundling, Drizzle schema generation into a temporary directory, browser startup, and API smoke. The ORM's new query-error wrapper required connection recovery to follow Error.cause. The existing recovery test reproduced the failure and passes with this adjustment.

Drizzle ORM 0.45.2 includes the upstream [identifier escaping security fix](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9).
