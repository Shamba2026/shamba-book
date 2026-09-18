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

## Current next gate

Verify the live Supabase schema, storage and RLS/auth model before enabling cloud synchronization.

## Non-negotiable safety gates

- no paid subscription;
- no spending;
- no production data deletion;
- no credential rotation;
- no real payment/financial messaging;
- no live financial transactions.
