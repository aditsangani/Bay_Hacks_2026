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
