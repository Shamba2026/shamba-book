-- Ngombe Herdbook target schema.
-- Do not apply to production until the live Supabase project is inspected.

create extension if not exists pgcrypto;

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  locality text not null,
  timezone text not null default 'Africa/Nairobi',
  currency text not null default 'KES',
  created_at timestamptz not null default now()
);

create table if not exists public.farm_members (
  farm_id uuid not null references public.farms(id) on delete restrict,
  user_id uuid not null,
  role text not null default 'worker' check (role in ('owner','manager','worker','vet')),
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create table if not exists public.animals (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  animal_id text not null,
  rfid text,
  qr_value text,
  type text not null check (type in ('dairy_cow','bull','calf','heifer','other')),
  sex text,
  breed text not null,
  birth_date date,
  acquired_date date,
  source text,
  status text not null default 'active',
  dam_id uuid references public.animals(id) on delete restrict,
  sire_id uuid references public.animals(id) on delete restrict,
  photo_path text,
  notes text,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, animal_id),
  unique (client_id)
);

create table if not exists public.milk_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  animal_id uuid not null references public.animals(id) on delete restrict,
  local_date date not null,
  session text not null check (session in ('morning','afternoon','evening')),
  yield_liters numeric(10,2) not null check (yield_liters > 0 and yield_liters <= 60),
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  animal_id uuid not null references public.animals(id) on delete restrict,
  local_date date not null,
  kilograms numeric(10,2) not null check (kilograms > 0 and kilograms <= 2000),
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.breeding_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  animal_id uuid not null references public.animals(id) on delete restrict,
  event_type text not null check (event_type in ('heat','service','pregnancy_check','calving','abortion','other')),
  event_date date not null,
  expected_calving date,
  result text,
  notes text,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  animal_id uuid not null references public.animals(id) on delete restrict,
  treatment_type text not null,
  description text,
  treatment_date date not null,
  medicine text,
  dose text,
  provider text,
  withdrawal_end_date date,
  cost numeric(10,2) not null default 0 check (cost >= 0),
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.expense_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  category text not null,
  amount numeric(10,2) not null check (amount >= 0),
  expense_date date not null,
  notes text,
  supplier text,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.income_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  category text not null check (category in ('milk_sales','bull_sale','animal_sale','other')),
  amount numeric(10,2) not null check (amount >= 0),
  income_date date not null,
  reference text,
  notes text,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.payment_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  payment_type text not null,
  amount numeric(10,2) not null check (amount >= 0),
  payment_date date not null,
  counterparty_name text,
  counterparty_phone text,
  mpesa_code text,
  linked_record_type text,
  linked_record_id uuid,
  proof_path text,
  notes text,
  client_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  owner_type text not null,
  owner_id uuid not null,
  storage_path text not null,
  mime_type text not null,
  filename text,
  created_at timestamptz not null default now(),
  client_id uuid not null default gen_random_uuid(),
  unique (client_id)
);

create index if not exists idx_animals_farm on public.animals(farm_id);
create index if not exists idx_milk_farm_date on public.milk_logs(farm_id, local_date);
create index if not exists idx_milk_animal_date on public.milk_logs(animal_id, local_date);
create index if not exists idx_weight_animal_date on public.weight_logs(animal_id, local_date);
create index if not exists idx_breeding_animal_date on public.breeding_events(animal_id, event_date);
create index if not exists idx_health_animal_date on public.health_logs(animal_id, treatment_date);
create index if not exists idx_expense_farm_date on public.expense_logs(farm_id, expense_date);
create index if not exists idx_income_farm_date on public.income_logs(farm_id, income_date);
create index if not exists idx_payment_farm_date on public.payment_logs(farm_id, payment_date);
create index if not exists idx_attachment_owner on public.attachments(owner_type, owner_id);
