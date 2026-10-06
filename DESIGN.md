# DESIGN.md

## Purpose

Design context for AI agents (and people) who build or review UI in this product. The source of truth for tokens is **`frontend/src/styles/index.css`** (the Tailwind v4 `@theme` block). Keep this file under 400 lines.

## Product

- **Name:** Trip Planner (ELD logs and route stops).
- **Audience:** truck drivers and dispatchers who need a legal plan for a trip and the paper-style log sheets that go with it. Used on a desktop at the dispatch desk and on a phone in a cab.
- **Visual tone:** calm and exact, deep teal with one warm accent. A tool, not a campaign page.
- **Principles:**
  - Numbers first. Distance, hours and arrival are the largest text on the results.
  - Say what happened. Loading, empty and error states always carry words.
  - The log sheet is a form, not a card. It stays black on white, like the paper original, with entries in ink blue.
  - Every number can be traced. A stop, a total or a recap value links back to a rule in [`docs/hos-rules.md`](./docs/hos-rules.md).

## Visual system

- **Tokens:** `frontend/src/styles/index.css`. Use the variables and Tailwind classes built from them (`teal-*`, `coral-*`, `ink-*`). No loose hex values in components.
- **Palette:** `teal-950` `#043D4C` (header, headings, dropoff), `teal-600` `#008080` (primary actions, pickup, deadhead leg), `coral-500` `#F84960` (main action button, start marker, loaded leg), `mint-200` `#BCDDDE` (soft fills), `ink-*` (neutral text and borders). The palette is taken from the assessment template. The logo isn't used.
- **Route colors:** the leg to the pickup is a dashed teal line, the loaded leg is solid coral, both over a thin white casing so they read on any tile.
- **Stop colors:** each stop kind has its own icon and color, shown in the map legend (start, pickup, dropoff, fuel, 30-minute break, 10-hour rest, 34-hour restart).
- **Type:** Inter Variable, self-hosted through Fontsource. Inputs are 16 px on phones so iOS doesn't zoom on focus. The log sheet uses Helvetica/Arial only, so the PDF needs no embedded fonts.
- **Shape and depth:** rounded cards (`rounded-2xl` and up), shadows `--shadow-card`, `--shadow-pop`, `--shadow-field`.
- **Motion:** short fades and slides. Everything stops under `prefers-reduced-motion`.
- **Icons:** `lucide-react` only. Don't mix icon sets.
- **Dark mode:** not supported yet. The log sheets would stay white either way.

## Accessibility: minimums

- AA contrast: 4.5:1 for normal text, 3:1 for large text. Coral text on white uses `coral-700`.
- Visible focus on every interactive element.
- Tap targets of 36 px or more on phones.
- Every flow works from the keyboard. Tabs use a roving tab index: Tab lands on the selected tab, arrow keys move between tabs.
- Dialogs trap focus, close on Escape and return focus to the control that opened them.
- Forms use a real `<label>` and say what's wrong in words.
- The log sheet SVG has a `<title>` and `<desc>` that state the day in plain words.
- The E2E suite runs axe-core on the empty page, the results, the sign-in dialog and the trips drawer, and fails on serious or critical findings.

## Components: inventory

Built in-house. Base styles live in `frontend/src/components/ui/`.

| Component | Status | Location | Notes |
|---|---|---|---|
| Button | Stable | `components/ui/Button.tsx` | Variants for primary (coral), secondary, quiet. Shows a spinner when pending. |
| Field, inputs | Stable | `components/ui/Field.tsx`, `inputClasses.ts` | Label, hint and error wired with ARIA. |
| Tabs | Stable | `components/ui/Tabs.tsx` | Roving tab index, arrow keys, Home and End. |
| Modal, drawer | Stable | `components/ui/Modal.tsx` | Focus trap, scroll lock, Escape. The trips list is the drawer variant. |
| Banner | Stable | `components/ui/Banner.tsx` | Info, warning and error, with retry. |
| Toast | Stable | `components/ui/Toast.tsx` | Polite live region. |
| Skeleton, Spinner | Stable | `components/ui/` | Loading states. |
| PlaceField | Stable | `features/trip-form/PlaceField.tsx` | Combobox with typeahead and a pick-on-map button. |
| TripMap | Stable | `features/map/TripMap.tsx` | Leaflet map, stop markers, popups, legend. |
| LogSheet, LogViewer | Stable | `features/logs/` | The paper form as SVG, with day navigation, PDF and print. |

## Composition rules

- A form has one primary button. The coral "Plan trip" button is it.
- A dialog never holds another dialog.
- Every screen defines its empty, loading and error states before it ships.
- Stop kinds look the same everywhere: the map marker, the legend, the itinerary card and the log remark use one icon per kind.
- Times on screen and on the sheets are home terminal time, and the screen says which zone.

## What we don't do

- No emojis in product UI.
- No new component or map library without discussion.
- No screens without an empty state.
- No loose hex colors. Use the tokens.
- No API text injected as HTML. Marker icons and popups are built from static markup or React children.

## Writing

UI text is plain and specific. Short sentences, contractions, sentence-case headings, no hype words and no em dashes. A button names its action: "Plan trip", "Download PDF", "Save trip".

## References

- Tokens: `frontend/src/styles/index.css`.
- Components: `frontend/src/components/ui/`.
- The paper form we recreate: `blank-paper-log.png` in the assessment kit, and the FMCSA guide (pages 15 to 19).
- Agent conventions: [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md).
