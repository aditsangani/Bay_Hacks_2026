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

create index if not exists check_ins_patient_id_idx on check_ins (patient_id, created_at);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  clinician_id text not null,
  action text not null,
  target_patient_hash text,
  created_at timestamptz not null default now()
);
