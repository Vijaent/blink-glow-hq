# Blink & Glow HQ: notes for Claude

Owner of the build: Victor Mwai (VIJA Enterprises). Client: Blink and Glow (owner Kate). Same pattern as Morart HQ.

## Shape
- `index.html` is a **generated** single file: login gate + Supabase adapter + the app. Its source lives outside this repo in the build folder (`a_head.html`, `b_core.js` ... `j_shell.js`, `sa_gate.html`, `sa_shim.js`, `build_sa.sh`). If those are not available, edit `index.html` directly; it is plain HTML/CSS/JS with no build step.
- `window.__standalone = true` selects the Supabase branch. The same app code also ran as a Claude artifact (collections under `p/main/...`); in standalone mode collections are top-level and booking requests are in the `inbox` collection, settings at `cfg/settings`, public settings at `pubcfg/main`.
- `window.claude` is a small shim over Supabase so the app code is unchanged. `window.bghq = {sb, ready, signOut}`.
- Config: `config.js` (URL + publishable key only).

## Rules that must not break
- Never put the secret / service_role key or the DB password in the repo or the page.
- Customers (signed out) may only call `public_booking_config`, `public_busy`, `public_request_booking`. Never grant `anon` access to `records`.
- Slot overlap is enforced by the `slots_guard` trigger and an advisory lock per day. Keep both.
- Money is whole-shilling integers. Revenue is recognised when an appointment is completed. Ledgers (stock moves, payments, transfers) are append-only.
- WhatsApp is click-to-chat only. Do not claim a message was sent.

## Testing
- `cd tests && npm install && npm test` runs the schema, row-level-security and booking-function tests against PGlite (Postgres 16). Re-run after any change to `supabase/schema.sql`.
- PGlite is one connection, so true parallel booking was checked separately against a real Postgres 16 server: 24 simultaneous requests for 2 stylists gave exactly 2 successes and no overlaps.
