# Ngombe Herdbook

Ngombe Herdbook is a local-first livestock and farm-record PWA for Kenyan dairy and beef workflows. The released application records animals, milk sessions, health work, bull weights, breeding events and farm finances in IndexedDB while cloud synchronization remains disabled.

## Released baseline

- Production branch: `main`
- Verified head: `8c7ed1907cc2ff2861b8262fdce76942a6e2f0f5`
- Candidate UI build: `20261008-01` (signed-out landing design correction; not released)
- Hosting: GitHub Pages
- Authentication: required before farm views render
- Local ownership: active farm membership and local farm identifiers gate new records
- Cloud synchronization and cloud restore: disabled

## Implemented safeguards

- atomic animal, photo and pending-queue persistence;
- atomic record and pending-queue persistence;
- signed-out DOM clearing and stale-refresh protection;
- farm-scoped local repositories and explicit legacy-record recovery;
- isolated two-account, rollback, reload, reopen and sign-out browser tests;
- evidence-backed feed, inventory, nutrition-classification and requirement-review workflows;
- read-only ration evidence, comparison and review governance;
- responsive and accessibility regression coverage.

## Deliberately unavailable

- automatic ration recommendations;
- automatic inventory consumption from ration reviews;
- production nutrition threshold defaults without reviewed evidence;
- cloud synchronization or restore;
- autonomous schema migrations, RLS changes, payments or production-data deletion.

## Verification

```bash
npm ci
npm test
npm run test:browser
```

The browser suite uses synthetic accounts and records in an isolated profile. It must not use real farm data.

See `docs/FARM-OPERATING-CONTRACT.md`, `docs/TAKEOVER-JOURNAL.md` and `docs/SUPABASE-FORENSIC-AUDIT.md` for the governing constraints and evidence boundaries.
