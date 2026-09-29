-- MVP-A0 · Writing Evidence — RLS va GRANT (TZ v4 §22)
-- RLS qatorlarni, GRANT esa amallarni cheklaydi — ikkalasi ham kerak.

-- ---------------------------------------------------------------------------
-- 1. Hamma narsani yopamiz (Supabase default ruxsatlari ham)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.documents enable row level security;
alter table public.sessions  enable row level security;
alter table public.mutations enable row level security;
alter table public.snapshots enable row level security;
alter table public.events    enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy documents_select_own on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy documents_update_own on public.documents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy documents_delete_own on public.documents
  for delete to authenticated using (user_id = (select auth.uid()));

create policy sessions_select_own on public.sessions
  for select to authenticated using (exists (
    select 1 from public.documents d where d.id = sessions.document_id and d.user_id = (select auth.uid())));
create policy mutations_select_own on public.mutations
  for select to authenticated using (exists (
    select 1 from public.documents d where d.id = mutations.document_id and d.user_id = (select auth.uid())));
create policy snapshots_select_own on public.snapshots
  for select to authenticated using (exists (
    select 1 from public.documents d where d.id = snapshots.document_id and d.user_id = (select auth.uid())));
create policy events_select_own on public.events
  for select to authenticated using (exists (
    select 1 from public.documents d where d.id = events.document_id and d.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. GRANT — faqat kerakli minimal ruxsatlar (anon: hech narsa)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;

-- INSERT yo'q: hujjat create_document orqali (boshlang'ich snapshot bilan) yaratiladi.
-- UPDATE faqat title ustunida; content faqat save_document orqali.
grant select, delete on public.documents to authenticated;
grant update (title) on public.documents to authenticated;

-- Evidence jadvallari: faqat o'qish. INSERT/UPDATE/DELETE hech kimga berilmaydi
-- (yozish SECURITY DEFINER funksiyalar orqali, o'chirish faqat cascade).
grant select on public.sessions, public.mutations, public.snapshots, public.events to authenticated;

grant execute on function public.create_document(text) to authenticated;
grant execute on function public.save_document(uuid, integer, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.ingest_events(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.document_timeline(uuid) to authenticated;
