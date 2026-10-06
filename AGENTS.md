# AGENTS.md

Conventions shared by every AI agent that works in this repository (Claude Code, Cursor, Copilot and the rest). An agent with its own file (`CLAUDE.md`, `.cursorrules`) extends what's declared here and doesn't contradict it.

## Project context

Trip planner for property-carrying truck drivers. It routes a trip, applies the FMCSA hours-of-service rules and fills out one daily ELD log sheet per day. Stack: Django 5.2 + Django REST framework, React 19 + TypeScript + Vite + Tailwind v4, Postgres (SQLite locally), one Vercel project. See [`CLAUDE.md`](./CLAUDE.md), [`specs.md`](./specs.md) and [`docs/hos-rules.md`](./docs/hos-rules.md).

## Authorized scope

The agent **may** change without asking:

- Files under `backend/apps/`, `backend/tests/`, `frontend/src/`, `frontend/e2e/` and `docs/`.
- Documentation (`*.md`).
- Lint and format config that doesn't touch infrastructure.

The agent **must ask** before:

- Touching `.env*`, secrets, credentials or keys.
- Changing database models or migrations (`backend/apps/*/migrations/`).
- Editing CI/CD (`.github/`) or `vercel.json`.
- Changing the API contract. [`docs/api-contract.md`](./docs/api-contract.md), `frontend/src/api/types.ts` and `backend/apps/planner/types.py` change together, in one commit.
- Changing a driving rule in `backend/apps/planner/hos/`. The rules live in [`docs/hos-rules.md`](./docs/hos-rules.md); update the doc and the tests in the same change.
- Deleting tracked files it didn't create in the current session.

## Commit style

- Conventional Commits in English: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `test:`.
- One commit per logical change. No grouping for convenience.
- No rewriting history that's already pushed.

## Required verification

Before proposing a PR or closing a task:

1. **Backend** (from `backend/`): `ruff check .`, `ruff format --check .`, `pytest`.
2. **Frontend** (from `frontend/`): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
3. **End to end** when the UI or the API changed: `npx playwright test`.
4. **No secrets**: read the diff for keys, tokens and passwords. `.env` is never committed.

## Expected output from the agent

- **Plan before editing.** If the change touches 3 or more files, summarize the plan first.
- **Readable diff.** Small, local changes. No mass reformatting mixed with logic.
- **Verifiable result.** Say how to tell it works: a command, an endpoint, a test.

## Technical conventions

- **Layers.** Views validate and call a service. Services hold the logic. Providers talk to outside services. Models store data. No logic in views, no HTTP in the engine.
- **The engine is pure.** `backend/apps/planner/hos/` takes numbers and returns segments. No Django imports, no network. Keep it that way so it stays testable.
- **Contract first.** Field names are `snake_case` on the wire. A change to a shape starts in `docs/api-contract.md`.
- **Imports.** Frontend code uses the `@/` alias for `src/`.
- **Tests.** Every behavior change comes with a test that fails without it. Frontend test ids are listed in [`docs/testing.md`](./docs/testing.md).
- **Language.** UI text, docs, comments and commits are in English.

## Common mistakes to avoid

- Writing parallel documentation that goes stale (a README inside every subfolder).
- Tests that would still pass if the code were broken.
- Adding a dependency without a reason.
- "While I'm here" refactors that don't belong to the change.
- Calling the live OSRM, Photon or Nominatim services from tests. Use the fake upstream or `responses`.
