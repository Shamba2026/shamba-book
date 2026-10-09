# Ngombe Herdbook — Takeover Journal

## Entry 001 — Baseline inherited

The original repository was inspected read-only before changes.

Observed:
- small vanilla JavaScript/PWA structure;
- direct Supabase browser integration;
- basic animal, milk, breeding, health and expense intent;
- service-worker shell caching;
- no actual offline record persistence;
- no versioned Supabase schema in the repository;
- no visible authentication/RLS configuration;
- biological rules not connected to the active HTML workflow.

Conclusion:
The inherited code is a useful prototype foundation, not yet a reliable production farm-record system.

## Entry 002 — Farm contract accepted

Dairy:
- three milking sessions per day;
- evening delivery;
- Saturday weekly payment for the preceding Saturday-Friday period;
- KSh 49/litre.

Bulls:
- weight is the primary operational measure.

Additional requirements:
- every animal needs a photograph;
- nickname identity must coexist with RFID/QR readiness;
- transaction evidence and event attachments are supported;
- Animal 360 is the central user experience.

## Entry 003 — Controlled foundation branch

Development branch:
ngombe-herdbook-foundation

Production main has not been changed.

## Entry 004 — Foundation build

The first implementation slice establishes:
1. formal farm rules;
2. IndexedDB local persistence;
3. local sync queue;
4. the new application shell;
5. a versioned target Supabase schema;
6. cloud sync intentionally disabled until schema, RLS and auth are verified.

## Entry 005 — Weather constraint

Weather remains behind a provider adapter. No paid weather service is enabled by this branch.

## Historical next gate (superseded by Entry 006)

Verify the live Supabase schema, storage and RLS/auth model before enabling cloud synchronization.

## Non-negotiable safety gates

- no paid subscription;
- no spending;
- no production data deletion;
- no credential rotation;
- no real payment/financial messaging;
- no live financial transactions.

## Entry 006 — Released local-first baseline

Verified on 2026-10-09 before the subsequent visual releases:

- `main` pointed to `8c7ed1907cc2ff2861b8262fdce76942a6e2f0f5`;
- GitHub Pages served UI build `20261007-14`;
- authentication gates farm views and signed-out rendering contains no animal cards;
- the sign-in landing has desktop and 390 × 844 browser regression evidence;
- local animal/photo/queue and record/queue saves use atomic IndexedDB transactions;
- new local records are farm-scoped after membership verification;
- legacy local ownership requires explicit backup comparison and farmer confirmation;
- cloud synchronization and Restore remain disabled.

Released review workflows now cover:

- farm-scoped feed library and source observations;
- inventory batches, cost provenance and reviewed movements;
- nutrition evidence, versioned diagnostics and animal classification governance;
- documented requirements and read-only ration evidence comparisons;
- append-only review, supersession and stale-evidence handling;
- local finance records with farm-scoped access.

These workflows do not authorize automatic ration recommendations, automatic inventory consumption, production threshold seeding, cloud writes, schema migrations or RLS changes.

## Entry 007 — Released landing and icon system

Verified on 2026-10-09:

- PR #54 merged as `b00ba2ca1217743c7f92bfdaad48c0259993c465`;
- `main` points to that merge commit;
- GitHub Pages serves UI build `20261009-01`;
- signed-out startup exposes no farm view or primary navigation;
- authenticated desktop and mobile regression evidence shows the local SVG icon system in the brand, primary navigation and recording shortcuts;
- the post-merge browser workflow passed on rerun after one transient authentication-readiness timeout;
- no application-origin console error was observed on the deployed signed-out page.

This visual release changed no persistence, authentication, farm-scoping, finance, nutrition, cloud, schema or RLS logic.

## Current next gate

Keep the released safety boundaries intact while completing focused usability and evidence-quality audits. Any future cloud work requires a separate live-schema, membership, storage and RLS release unit.
