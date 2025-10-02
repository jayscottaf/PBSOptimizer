# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Express API, Vite dev integration, routes, DB helpers (e.g., `server/routes.ts`, `server/db.ts`).
- `client/`: Vite + React app (`client/src` for pages, components, hooks, and libs).
- `shared/`: Shared types/schemas (e.g., `shared/schema.ts`).
- `migrations/`: SQL migrations and Drizzle metadata.
- `docs/`, `README.md`, `DEVELOPMENT_NOTES.md`: Reference material and ideas.

## Build, Test, and Development Commands
- `npm run dev` — Start API with Vite-integrated development server.
- `npm run build` — Build client (Vite) and bundle server (esbuild) to `dist/`.
- `npm start` — Run production server from `dist/`.
- `npm run check` — Type-check with `tsc`.
- `npm run db:push` — Apply Drizzle schema changes.
- `npm run lint` / `npm run lint:fix` — Lint and auto-fix.
- `npm run format` / `npm run format:check` — Prettier format/verify.

## Coding Style & Naming Conventions
- TypeScript-first; React function components; Tailwind for styling where applicable.
- Enforced by ESLint (flat config) and Prettier. Run lint/format before pushing.
- Filenames: `kebab-case.ts[x]` (e.g., `client/src/components/profile-modal.tsx`).
- Components export `PascalCase`; variables/functions use `camelCase`.
- Keep modules cohesive; avoid cross-layer imports (client↔server) except via `shared/`.

## Testing Guidelines
- No dedicated runner configured. Prefer fast, co-located tests `*.test.ts[x]` if adding.
- Focus on server route handlers, shared schema validation, and critical hooks/components.
- Always run `npm run check`, `lint`, and manual smoke tests via `npm run dev`.

## Commit & Pull Request Guidelines
- Commits: imperative, concise, single-scope (e.g., "Fix profile modal validation").
- Reference issues (`#123`) when applicable; avoid drive-by changes.
- PRs: clear description, scope, screenshots for UI changes, and verification steps.
- CI-readiness: ensure `check`, `lint`, and `format:check` pass before review.

## Security & Configuration Tips
- Env loaded via `dotenv`. Common vars: `PORT`, `DATABASE_URL`, `LOG_LEVEL`, `LOG_HTTP`, `OPENAI_API_KEY`.
- Never commit secrets; prefer `.env.local` for machine overrides.
- Apply migrations with `npm run db:push` after schema changes; keep `migrations/` in sync.

## Agent-Specific Instructions
- Keep changes minimal and aligned with existing patterns and filenames.
- Do not rename files or modify build scripts without discussion.
- Prefer small, focused PRs with rationale and examples.
