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
  triage_tier smallint default 1,
  triage_label text default 'Stable',
  triage_action text,
  triage_reason text,
  face_method text,
  face_sample_count integer,
  wellness jsonb,
  vital_signs jsonb,
  created_at timestamptz not null default now()
);

alter table check_ins add column if not exists vital_signs jsonb;

alter table check_ins add column if not exists triage_tier smallint default 1;
alter table check_ins add column if not exists triage_label text default 'Stable';
alter table check_ins add column if not exists triage_action text;
alter table check_ins add column if not exists triage_reason text;

create index if not exists check_ins_patient_id_idx on check_ins (patient_id, created_at);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  clinician_id text not null,
  action text not null,
  target_patient_hash text,
  created_at timestamptz not null default now()
);

-- Deny direct browser access to clinical and audit data. The Flask backend is
-- the only reader/writer and uses the service_role key, which bypasses RLS
-- after enforcing patient/clinician authorization in backend/auth.py.
alter table check_ins enable row level security;
alter table audit_log enable row level security;

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

-- The frontend needs only the logged-in user's own profile. Clinicians obtain
-- the patient list through the role-protected Flask endpoint, not directly.
drop policy if exists "profiles_select_authenticated" on profiles;
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles for select
  to authenticated
  using (auth.uid() = id);

-- Defense-in-depth: a logged-in user may insert only their own row.
-- The normal signup path (POST /api/profile) uses the service_role key
-- and bypasses this entirely. This policy just stops a logged-in user
-- from ever inserting/overwriting someone else's row via a direct
-- Supabase REST call.
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own"
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- No update/delete policies -> RLS defaults to deny. Prevents a
-- patient from later editing their own row to role='clinician'.
