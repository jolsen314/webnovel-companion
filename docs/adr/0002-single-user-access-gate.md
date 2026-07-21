# 2. Single-user access gate: hashed passphrase + signed cookie

Date: 2026-07-21
Status: Accepted

## Context

The app is deployed to a public URL (Vercel) but is a **single-user** tool. We deliberately deferred a `User`
table and real multi-user auth to Tier 4 (see [ADR 0001](0001-source-as-swappable-fetch-target.md) and CONTEXT.md),
which left every API route unauthenticated — anyone with the URL could read the library, add/edit series, and
register for push. That's unacceptable for a public deployment, but standing up a full identity provider would drag
in the User model we intentionally postponed.

## Decision

A **one-lock gate for the whole app**, not multi-user auth:

- **Passphrase**, stored as a salted **scrypt hash** in `AUTH_PASSWORD_HASH` (never the raw secret). The owner
  generates a high-entropy passphrase (`npm run auth:hash`) kept in a password manager. Format is colon-separated
  (`scrypt:salt:hash`) so it survives `dotenv-expand`.
- **Session cookie**: an HMAC-signed token (`AUTH_SECRET`), `HttpOnly` + `Secure` + `SameSite=Lax`, signed/verified
  with Web Crypto so the same code runs in edge middleware and Node routes.
- **Next middleware** gates all pages + APIs; the allowlist is login, the auth endpoints, the PWA files, and
  `/api/cron/poll` (which keeps its own `CRON_SECRET`). **Fail-closed in production**: with no `AUTH_SECRET` the gate
  is open in dev (convenience) but closed in prod, so a forgotten env var never ships an open API.
- `getCurrentUserId()` stays `'local'` — the gate guards *access to the single account*, it does not introduce users.

## Consequences

- **+** Closes the open-API hole with a tiny, dependency-free surface; no `User` table, no auth provider.
- **+** The Tier-4 multi-user path stays clean — `getCurrentUserId()` is still the one seam to replace.
- **−** A shared secret is not per-user and not phishing-resistant. Mitigated by a high-entropy passphrase; the real
  upgrade is **passkeys/WebAuthn** (deferred as WP-PASSKEY).
- **−** Production must have `AUTH_PASSWORD_HASH` + `AUTH_SECRET` set; the fail-closed default turns a missing config
  into "locked out" rather than "wide open".

## Alternatives rejected

- **No auth / rely on URL obscurity** — a public URL is not a secret.
- **Auth.js / a full identity provider** — reintroduces the deferred `User` model; overkill for one user.
- **Vercel deployment password protection** — a paid feature, and it would also block the cron endpoint and the PWA
  install/notification flow.
