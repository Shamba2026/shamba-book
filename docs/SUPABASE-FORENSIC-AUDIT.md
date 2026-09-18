# Ngombe Herdbook — Supabase Forensic Audit
## 18 September 2026 — read-only findings

## Scope

This is a forensic review of the Supabase state that can be established from:
1. the farm's supplied SQL;
2. the existing repository source;
3. current Supabase documentation.

No SQL was executed against the production database by this audit and no production data was modified.

## Verified from supplied SQL

### Table 1: animals

Columns:
- animal_id TEXT PRIMARY KEY
- breed TEXT NOT NULL
- birth_date DATE
- status TEXT DEFAULT 'Active'
- created_at TIMESTAMPTZ DEFAULT NOW()

RLS:
- explicitly disabled.

### Table 2: health_logs

Columns:
- id UUID PRIMARY KEY DEFAULT gen_random_uuid()
- animal_id TEXT NOT NULL
- treatment_type TEXT NOT NULL
- description TEXT
- treatment_date DATE NOT NULL
- cost NUMERIC(10,2) DEFAULT 0
- created_at TIMESTAMPTZ DEFAULT NOW()

There is no foreign-key constraint shown between health_logs.animal_id and animals.animal_id.

RLS:
- explicitly disabled.

### Table 3: expense_logs

Columns:
- id UUID PRIMARY KEY DEFAULT gen_random_uuid()
- category TEXT NOT NULL
- amount NUMERIC(10,2) NOT NULL
- expense_date DATE NOT NULL
- notes TEXT
- created_at TIMESTAMPTZ DEFAULT NOW()

There is no animal relationship and no farm relationship in the supplied definition.

RLS:
- explicitly disabled.

## Cross-check against the inherited application

The existing application also references:
- milk_logs
- breeding_logs

Those tables are not defined in the supplied SQL.

This is an unresolved infrastructure mismatch.

## Security finding

The supplied SQL explicitly disables RLS on all three supplied tables.

Supabase's current documentation states that RLS is the row-level authorization boundary and recommends enabling RLS for exposed tables, while grants separately determine whether a role can reach the object. An exposed table without RLS can be readable/writable by roles holding appropriate grants. citeturn359523search0turn359523search5

Therefore the existing configuration must not be used as the production security model for the new multi-farm-capable application.

## Migration hazard discovered

The committed target design currently assumes:
- public.animals has a UUID id column;
- child tables reference animals(id).

The supplied live definition instead uses:
- animal_id TEXT PRIMARY KEY;
- no UUID id column.

Therefore the target SQL must be treated as a design draft, not an executable production migration.

It cannot safely be applied directly to the current database.

A non-destructive migration plan must first:
1. preserve the current animal_id values;
2. introduce a stable internal UUID if required;
3. add farm scoping;
4. backfill and verify relationships;
5. introduce child-table foreign keys;
6. migrate existing health/expense records;
7. establish Auth/farm membership;
8. enable RLS and least-privilege grants;
9. test allow/deny behavior;
10. only then enable cloud synchronization.

## Current live-database unknowns

Not established by the supplied SQL:
- actual table list in the live project;
- actual current row counts;
- actual grants;
- actual RLS policies;
- actual storage buckets;
- actual Auth configuration;
- actual Data API exposure;
- actual indexes;
- actual foreign keys;
- actual triggers/functions;
- whether milk_logs and breeding_logs exist in the live project.

The Supabase REST endpoint could not be inspected through the available web access. This audit therefore does not claim those unknowns are absent.

## Security gate

Cloud synchronization remains disabled.

Do not enable it until the live schema and policies are inspected and the non-destructive migration path has been verified.

## Required Supabase verification

Run in Supabase SQL Editor or Supabase's supported inspection tooling:

1. Tables and RLS:
   select tablename, rowsecurity
   from pg_tables
   where schemaname = 'public'
   order by tablename;

2. Policies:
   select tablename, policyname, cmd, roles
   from pg_policies
   where schemaname = 'public'
   order by tablename, policyname;

3. Foreign keys:
   inspect pg_constraint / information_schema referential constraints.

4. Grants:
   inspect information_schema.role_table_grants for anon/authenticated/service_role.

5. Storage:
   inspect storage.buckets and storage.objects policies.

6. Auth:
   verify enabled providers and intended farm/user model.

Supabase currently recommends inspecting RLS state and policies and testing allow/deny behavior before relying on the security model. citeturn359523search0turn359523search1
