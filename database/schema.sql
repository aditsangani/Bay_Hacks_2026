-- Run this in the Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query).

create table if not exists check_ins (
  id bigint generated always as identity primary key,
  patient_id text not null,
  facial_asymmetry_score double precision,
  voice_jitter double precision,
  response_latency_ms double precision,
  risk_score double precision,
  risk_level text,
  flags jsonb default '[]'::jsonb,
  face_method text,
  face_sample_count integer,
  wellness jsonb,
  created_at timestamptz not null default now()
);

create index if not exists check_ins_patient_id_idx on check_ins (patient_id, created_at);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  clinician_id text not null,
  action text not null,
  target_patient_hash text,
  created_at timestamptz not null default now()
);

-- NOTE: check_ins and audit_log intentionally do NOT have RLS enabled.
-- The Flask backend is the only writer/reader of these tables and always
-- uses the Supabase service_role key (see database/db.py), which bypasses
-- RLS entirely -- so RLS policies here would be theater, not protection.
-- Authorization for these tables is enforced in Flask (see backend/auth.py).

-- Profiles: one row per Supabase Auth user, created at signup time via
-- POST /api/profile (see backend/app.py) rather than a direct client
-- insert, since the standard confirm-email flow means there's no active
-- session yet at signup time.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('patient', 'clinician')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on profiles (role);

alter table profiles enable row level security;

-- Any authenticated user may read all profiles. The clinician-only
-- GET /api/patients endpoint itself is protected by Flask (not this
-- policy) since it uses the service_role key; this policy exists for
-- the frontend's own direct profile lookups (AuthContext fetching the
-- logged-in user's own role/name) and as a sane default for this table.
create policy "profiles_select_authenticated"
  on profiles for select
  to authenticated
  using (true);

-- Defense-in-depth: a logged-in user may insert only their own row.
-- The normal signup path (POST /api/profile) uses the service_role key
-- and bypasses this entirely. This policy just stops a logged-in user
-- from ever inserting/overwriting someone else's row via a direct
-- Supabase REST call.
create policy "profiles_insert_own"
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- No update/delete policies -> RLS defaults to deny. Prevents a
-- patient from later editing their own row to role='clinician'.
