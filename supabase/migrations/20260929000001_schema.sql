-- MVP-A0 · Writing Evidence — schema (TZ v4 §21, A0 qismi)
-- Evidence Page, Verify, analyses va boshqalar A1/B migratsiyalarida qo'shiladi.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text check (display_name is null or char_length(display_name) <= 80),
  locale         text not null default 'uz' check (locale in ('uz', 'en')),
  plan           text not null default 'free' check (plan in ('free')),
  llm_consent_at timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- documents
-- content_text, word_count va doc_size FAQAT save_document ichida
-- content_json dan hisoblanadi (clientdan olinmaydi).
-- ---------------------------------------------------------------------------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default '' check (char_length(title) <= 200),
  content_json jsonb not null,
  content_text text not null default '',
  language     text not null default 'en' check (language = 'en'),
  word_count   integer not null default 0,
  doc_size     integer not null,
  version      integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index documents_user_updated_idx on public.documents (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- sessions — id client'da yaratiladi (offline paytda ham session ochilishi uchun)
-- ---------------------------------------------------------------------------
create table public.sessions (
  id               uuid primary key,
  document_id      uuid not null references public.documents (id) on delete cascade,
  started_at       timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at         timestamptz,
  end_reason       text check (end_reason in ('idle', 'pagehide')),
  created_at       timestamptz not null default now()
);
create index sessions_document_idx on public.sessions (document_id, started_at);

-- ---------------------------------------------------------------------------
-- mutations — yagona manba (mutation ledger, TZ §10.9). Compaction qilinmaydi.
-- inserted_chars / deleted_chars — belgilar SONI (matnning o'zi saqlanmaydi).
-- ---------------------------------------------------------------------------
create table public.mutations (
  id                 bigint generated always as identity primary key,
  client_mutation_id uuid not null unique,
  document_id        uuid not null references public.documents (id) on delete cascade,
  session_id         uuid not null references public.sessions (id) on delete cascade,
  document_version   integer not null,
  seq                integer not null check (seq >= 1),
  from_pos           integer not null check (from_pos >= 0),
  to_pos             integer not null check (to_pos >= from_pos),
  deleted_size       integer not null check (deleted_size >= 0),
  inserted_size      integer not null check (inserted_size >= 0),
  deleted_chars      integer not null check (deleted_chars >= 0),
  inserted_chars     integer not null check (inserted_chars >= 0),
  source             text not null check (source in (
                       'typing', 'paste', 'drop', 'replacement', 'bulk_input', 'unknown',
                       'history', 'ai', 'recovered', 'moved', 'delete')),
  client_ts          timestamptz not null,
  received_at        timestamptz not null,
  effective_ts       timestamptz not null,
  offline            boolean not null,
  clock_adjusted     boolean not null
);
create index mutations_document_version_idx on public.mutations (document_id, document_version);
create index mutations_session_seq_idx on public.mutations (session_id, seq);

-- ---------------------------------------------------------------------------
-- snapshots — faqat server oladi (save_document tranzaksiyasi ichida)
-- ---------------------------------------------------------------------------
create table public.snapshots (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents (id) on delete cascade,
  session_id       uuid references public.sessions (id) on delete set null,
  document_version integer not null,
  doc_size         integer not null,
  content_json     jsonb not null,
  content_text     text not null,
  content_hash     text not null,
  word_count       integer not null,
  reason           text not null check (reason in ('initial', 'interval', 'external', 'session_end', 'unrecorded')),
  pinned           boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (document_id, document_version)
);

-- ---------------------------------------------------------------------------
-- events — client event'lari (session, telemetriya) + ledger'dan hosil
-- qilingan (derived) event'lar
-- ---------------------------------------------------------------------------
create table public.events (
  id              bigint generated always as identity primary key,
  client_event_id uuid unique,
  document_id     uuid not null references public.documents (id) on delete cascade,
  session_id      uuid references public.sessions (id) on delete cascade,
  seq             integer,
  type            text not null check (type in (
                    'session_start', 'session_end', 'typing_activity',
                    'text_inserted', 'text_moved', 'revision', 'unrecorded_change')),
  payload         jsonb not null default '{}'::jsonb,
  derived         boolean not null default false,
  mutation_id     bigint references public.mutations (id) on delete cascade,
  schema_version  integer not null default 1,
  client_ts       timestamptz,
  received_at     timestamptz not null default now(),
  effective_ts    timestamptz not null,
  offline         boolean not null default false,
  clock_adjusted  boolean not null default false
);
create index events_document_ts_idx on public.events (document_id, effective_ts);
create index events_session_seq_idx on public.events (session_id, seq) where seq is not null;
